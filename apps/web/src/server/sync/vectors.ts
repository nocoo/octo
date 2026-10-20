import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import type { VectorStore } from "../ports/vector/types";
import { decodeFloat32Vector } from "../search/math";
import { createSearchVectorStore } from "../search/vector-store-factory";
import { isVectorRateLimit, retryVectorMutation, vectorErrorDetails } from "./vector-errors";

export const SYNC_LEASE_MS = 60_000;
export const FAILURE_BACKOFF_MS = 60 * 60 * 1000;
const MAX_FAILURES = 8;
const MUTATION_BATCH_SIZE = 100;

type Job = { memory_id: string };
type Claim = Job & { token: string; generation: number };
type Upsert = Claim & { record: VectorizeVector };

async function concurrent<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
	const pending = items.values();
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			for (const item of pending) await work(item);
		}),
	);
}

type SyncOptions = {
	store?: Pick<VectorStore, "upsert" | "delete"> & Partial<Pick<VectorStore, "query">>;
	now?: number;
	limit?: number;
	memoryIds?: string[];
	beforeSync?: (memoryId: string) => Promise<unknown>;
	beforeSyncBatch?: (memoryIds: string[]) => Promise<unknown>;
	deferMissingVectors?: boolean;
};

type SourceVector = {
	id: string;
	space: string;
	type: string;
	source: string;
	importance: number;
	created: number;
	updated: number;
	event: number | null;
	dim: number;
	vector: ArrayBuffer;
	content_hash: string;
};

async function invalidate(
	db: D1Database,
	memoryId: string,
	token: string,
	now: number,
): Promise<void> {
	await db.batch([
		db.prepare("UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = ?").bind(memoryId),
		db
			.prepare(`UPDATE vector_sync_jobs SET
			generation = generation + CASE WHEN lease_token IS NULL OR lease_token = ? THEN 1 ELSE 0 END,
			lease_dirty = CASE WHEN lease_token IS NOT NULL AND lease_token != ? THEN 1 ELSE 0 END,
			due_at = CASE WHEN lease_token = ? OR (last_error IS NULL AND dead_at IS NULL) THEN ? ELSE due_at END,
			lease_until = CASE WHEN lease_token = ? THEN 0 ELSE lease_until END,
			lease_token = CASE WHEN lease_token = ? THEN NULL ELSE lease_token END WHERE memory_id = ?`)
			.bind(token, token, token, now, token, token, memoryId),
	]);
}

export async function synchronizeVectors(
	env: Env,
	options: SyncOptions = {},
): Promise<{ synced: number; failed: number }> {
	const timestamp = () => options.now ?? Date.now();
	const now = timestamp();
	const limit = Math.max(
		0,
		Math.min(500, Math.trunc(options.limit ?? options.memoryIds?.length ?? 50)),
	);
	const configured = Number(env.OCTO_VECTOR_SYNC_CONCURRENCY);
	const concurrency = Number.isInteger(configured) && configured >= 1 ? Math.min(configured, 4) : 4;
	const totals = { synced: 0, failed: 0 };
	if (limit === 0) return totals;
	const profiles = await env.DB.prepare("SELECT id FROM embedding_profiles WHERE active = 1").all<{
		id: string;
	}>();
	if (profiles.results.length !== 1)
		throw new ApiError("unavailable", "one active embedding profile is required");
	const profileId = (profiles.results[0] as { id: string }).id;
	const store =
		options.store ??
		createSearchVectorStore(env, env.DB, profileId, {
			clauses: ["m.deleted_at IS NULL"],
			binds: [],
		});
	const target =
		options.memoryIds === undefined ? null : JSON.stringify([...new Set(options.memoryIds)]);
	const jobs = await env.DB.prepare(`SELECT memory_id FROM vector_sync_jobs
		WHERE dead_at IS NULL AND due_at <= ? AND lease_until <= ?
		AND generation IS NOT synced_generation
		AND (? IS NULL OR memory_id IN (SELECT value FROM json_each(?)))
		ORDER BY due_at, memory_id LIMIT ?`)
		.bind(now, now, target, target, limit)
		.all<Job>();
	const fail = async (job: Claim, stage: string, error: unknown, retry: Job[]) => {
		const failedAt = timestamp();
		totals.failed++;
		const rateLimited = (stage === "upsert" || stage === "delete") && isVectorRateLimit(error);
		const details = vectorErrorDetails(error);
		const entry = {
			memory_id: job.memory_id,
			...details,
			message: `Vector synchronization failed during ${stage}`,
		};
		console.error({
			event: rateLimited ? "vector_sync_rate_limited" : "vector_sync_failed",
			...entry,
		});
		const failed = rateLimited
			? await env.DB.prepare(`UPDATE vector_sync_jobs SET last_error = ?, due_at = ?,
				lease_token = NULL, lease_until = 0, lease_dirty = 0
				WHERE memory_id = ? AND generation = ? AND lease_token = ? AND dead_at IS NULL
				RETURNING attempts, dead_at`)
					.bind(
						details.error_message,
						failedAt + 60_000 + Math.floor(Math.random() * 60_000),
						job.memory_id,
						job.generation,
						job.token,
					)
					.first<{ attempts: number; dead_at: number | null }>()
			: await env.DB.prepare(`UPDATE vector_sync_jobs SET attempts = attempts + 1,
			last_error = ?, due_at = ? + min(1 << (attempts + 1), 24) * ?,
			dead_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END,
			lease_token = NULL, lease_until = 0, lease_dirty = 0
			WHERE memory_id = ? AND generation = ? AND lease_token = ? AND dead_at IS NULL
			RETURNING attempts, dead_at`)
					.bind(
						details.error_message,
						failedAt,
						FAILURE_BACKOFF_MS,
						MAX_FAILURES,
						failedAt,
						job.memory_id,
						job.generation,
						job.token,
					)
					.first<{ attempts: number; dead_at: number | null }>();
		if (!failed) {
			await invalidate(env.DB, job.memory_id, job.token, failedAt);
			retry.push(job);
			return;
		}
		await env.DB.prepare(`UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = ?
			AND EXISTS (SELECT 1 FROM vector_sync_jobs WHERE memory_id = ? AND generation = ? AND attempts = ?
			AND synced_generation IS NOT generation)`)
			.bind(job.memory_id, job.memory_id, job.generation, failed.attempts)
			.run();
		if (failed.dead_at !== null)
			console.error({ event: "vector_sync_dead", ...entry, attempts: failed.attempts });
	};
	const acknowledge = async (job: Claim, retry: Job[]) => {
		const completedAt = timestamp();
		const results = await env.DB.batch([
			env.DB.prepare(`UPDATE memory_vectors SET indexed_at = ? WHERE memory_id = ? AND profile_id = ?
				AND EXISTS (SELECT 1 FROM vector_sync_jobs WHERE memory_id = ? AND generation = ? AND lease_token = ? AND lease_dirty = 0)
				AND EXISTS (SELECT 1 FROM memories WHERE id = ? AND deleted_at IS NULL AND content_hash = memory_vectors.content_hash)
				AND (SELECT COUNT(*) FROM embedding_profiles WHERE active = 1) = 1
				AND EXISTS (SELECT 1 FROM embedding_profiles WHERE id = memory_vectors.profile_id AND active = 1 AND model = memory_vectors.embedding_model AND dims = memory_vectors.dim)`).bind(
				completedAt,
				job.memory_id,
				profileId,
				job.memory_id,
				job.generation,
				job.token,
				job.memory_id,
			),
			env.DB.prepare(`UPDATE vector_sync_jobs SET synced_generation = generation, lease_token = NULL,
				lease_until = 0, due_at = 0, attempts = 0, last_error = NULL, dead_at = NULL
				WHERE memory_id = ? AND generation = ? AND lease_token = ? AND lease_dirty = 0
				AND (SELECT COUNT(*) FROM embedding_profiles WHERE active = 1) = 1
				AND EXISTS (SELECT 1 FROM embedding_profiles WHERE id = ? AND active = 1)
				AND NOT EXISTS (
					SELECT 1 FROM memories memory JOIN embedding_profiles profile ON profile.id = ?
					JOIN settings setting ON setting.key = 'embedding.backfill_enabled' AND setting.value = 'true'
					LEFT JOIN memory_vectors vector ON vector.memory_id = memory.id AND vector.profile_id = profile.id
					WHERE memory.id = vector_sync_jobs.memory_id AND memory.deleted_at IS NULL
					AND (vector.memory_id IS NULL OR vector.content_hash != memory.content_hash
					OR vector.embedding_model != profile.model OR vector.dim != profile.dims)
				)`).bind(job.memory_id, job.generation, job.token, profileId, profileId),
		]);
		if (results[1]?.meta.changes === 1) {
			totals.synced++;
		} else {
			await invalidate(env.DB, job.memory_id, job.token, completedAt);
			retry.push(job);
		}
	};
	const claimJob = async (job: Job): Promise<Claim | null> => {
		const token = crypto.randomUUID();
		const claimedAt = timestamp();
		const claim =
			await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_token = ?, lease_until = ?, due_at = ?, lease_dirty = 0
			WHERE memory_id = ? AND dead_at IS NULL AND lease_until <= ? AND due_at <= ?
			AND generation IS NOT synced_generation
			AND (SELECT COUNT(*) FROM embedding_profiles WHERE active = 1) = 1
			AND EXISTS (SELECT 1 FROM embedding_profiles WHERE id = ? AND active = 1) RETURNING generation`)
				.bind(
					token,
					claimedAt + SYNC_LEASE_MS,
					claimedAt,
					job.memory_id,
					claimedAt,
					claimedAt,
					profileId,
				)
				.first<{ generation: number }>();
		return claim ? { ...job, token, generation: claim.generation } : null;
	};
	const syncAttempt = async (
		job: Job,
		upserts: Upsert[],
		deletes: Claim[],
		retry: Job[],
		prepared?: Claim,
	) => {
		const claimed = prepared ?? (await claimJob(job));
		if (!claimed) return;
		const token = claimed.token;
		let stage = "backfill";
		try {
			await options.beforeSync?.(job.memory_id);
			stage = "read";
			const refreshedAt = timestamp();
			const current = await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_until = ?, due_at = ?
				WHERE memory_id = ? AND lease_token = ? RETURNING generation`)
				.bind(refreshedAt + SYNC_LEASE_MS, refreshedAt, job.memory_id, token)
				.first<{ generation: number }>();
			if (!current) return;
			claimed.generation = current.generation;
			const source =
				await env.DB.prepare(`SELECT m.id, s.slug AS space, m.type, m.source_key_id AS source,
				m.importance, m.created_at AS created, m.updated_at AS updated, m.event_time AS event,
				mv.dim, mv.vector, mv.content_hash FROM memories m JOIN spaces s ON s.id = m.space_id
				JOIN memory_vectors mv ON mv.memory_id = m.id
				JOIN embedding_profiles profile ON profile.id = mv.profile_id
				WHERE m.id = ? AND m.deleted_at IS NULL AND mv.profile_id = ?
				AND mv.content_hash = m.content_hash AND mv.embedding_model = profile.model AND mv.dim = profile.dims`)
					.bind(job.memory_id, profileId)
					.first<SourceVector>();
			if (source) {
				upserts.push({
					...claimed,
					record: {
						id: source.id,
						values: decodeFloat32Vector(source.vector, source.dim),
						metadata: {
							generation: claimed.generation,
							content_hash: source.content_hash,
							space: source.space,
							type: source.type,
							source: source.source,
							importance: source.importance,
							created: source.created,
							updated: source.updated,
							...(source.event === null ? {} : { event: source.event }),
						},
					},
				});
			} else {
				if (options.deferMissingVectors && (await embeddingIds([job])).has(job.memory_id)) {
					await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_token = NULL,
						lease_until = 0, due_at = ? WHERE memory_id = ? AND lease_token = ?`)
						.bind(timestamp(), job.memory_id, token)
						.run();
					return;
				}
				deletes.push(claimed);
				return;
			}
		} catch (error) {
			await fail(claimed, stage, error, retry);
		}
	};
	const embeddingIds = async (candidates: Job[]) => {
		const needs = await env.DB.prepare(`SELECT memory.id FROM memories memory
			LEFT JOIN memory_vectors vector ON vector.memory_id = memory.id AND vector.profile_id = ?
			JOIN embedding_profiles profile ON profile.id = ?
			WHERE memory.id IN (SELECT value FROM json_each(?)) AND memory.deleted_at IS NULL
			AND (vector.memory_id IS NULL OR vector.content_hash != memory.content_hash
			OR vector.embedding_model != profile.model OR vector.dim != profile.dims)`)
			.bind(profileId, profileId, JSON.stringify(candidates.map((job) => job.memory_id)))
			.all<{ id: string }>();
		return new Set(needs.results.map((memory) => memory.id));
	};
	const flushMutations = async <Mutation extends Claim>(
		claims: Mutation[],
		stage: "upsert" | "delete",
		write: (ready: Mutation[]) => Promise<void>,
		retry: Job[],
	) => {
		let ready = claims;
		try {
			await retryVectorMutation(async () => {
				const ownedClaims: Mutation[] = [];
				await concurrent(ready, concurrency, async (job) => {
					const refreshedAt = timestamp();
					const owned =
						await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_until = ?, due_at = ?
						WHERE memory_id = ? AND generation = ? AND lease_token = ? RETURNING memory_id`)
							.bind(
								refreshedAt + SYNC_LEASE_MS,
								refreshedAt,
								job.memory_id,
								job.generation,
								job.token,
							)
							.first();
					if (owned) {
						ownedClaims.push(job);
					} else {
						const released = await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_token = NULL,
							lease_until = 0, due_at = ? WHERE memory_id = ? AND lease_token = ? RETURNING memory_id`)
							.bind(refreshedAt, job.memory_id, job.token)
							.first();
						if (released) retry.push(job);
					}
				});
				ready = ownedClaims;
				if (ready.length > 0) await write(ready);
			});
		} catch (error) {
			await concurrent(ready, concurrency, (job) => fail(job, stage, error, retry));
			return;
		}
		await concurrent(ready, concurrency, async (job) => {
			try {
				await acknowledge(job, retry);
			} catch (error) {
				await fail(job, "acknowledge", error, retry);
			}
		});
	};
	const needsEmbedding = options.beforeSyncBatch ? await embeddingIds(jobs.results) : new Set();
	const groups = options.beforeSyncBatch
		? [
				{
					jobs: jobs.results.filter((job) => !needsEmbedding.has(job.memory_id)),
					size: MUTATION_BATCH_SIZE,
				},
				{
					jobs: jobs.results.filter((job) => needsEmbedding.has(job.memory_id)),
					size: concurrency,
				},
			]
		: [{ jobs: jobs.results, size: MUTATION_BATCH_SIZE }];
	const batches: Job[][] = [];
	for (const group of groups) {
		for (let offset = 0; offset < group.jobs.length; offset += group.size) {
			batches.push(group.jobs.slice(offset, offset + group.size));
		}
	}
	for (const batch of batches) {
		let pending = batch;
		for (let round = 0; round < 3 && pending.length > 0; round++) {
			const upserts: Upsert[] = [];
			const deletes: Claim[] = [];
			const retry: Job[] = [];
			const flushReady = async () => {
				await flushMutations(
					upserts.splice(0),
					"upsert",
					(ready) => store.upsert(ready.map((job) => job.record)),
					retry,
				);
				await flushMutations(
					deletes.splice(0),
					"delete",
					(ready) => store.delete(ready.map((job) => job.memory_id)),
					retry,
				);
			};
			if (options.beforeSyncBatch) {
				for (let offset = 0; offset < pending.length; offset += concurrency) {
					const claims = (
						await Promise.all(pending.slice(offset, offset + concurrency).map(claimJob))
					).filter((claim): claim is Claim => claim !== null);
					if (claims.length === 0) continue;
					let embeddingClaims: Claim[];
					try {
						const needsEmbedding = await embeddingIds(claims);
						embeddingClaims = claims.filter((claim) => needsEmbedding.has(claim.memory_id));
					} catch (error) {
						await concurrent(claims, concurrency, (claim) => fail(claim, "read", error, retry));
						continue;
					}
					const ready = claims.filter((claim) => !embeddingClaims.includes(claim));
					await concurrent(ready, concurrency, (claim) =>
						syncAttempt(claim, upserts, deletes, retry, claim),
					);
					if (embeddingClaims.length === 0) continue;
					await flushReady();
					if (retry.length > 0) {
						await concurrent(embeddingClaims, concurrency, async (claim) => {
							const released = await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_token = NULL,
								lease_until = 0, due_at = ? WHERE memory_id = ? AND lease_token = ? RETURNING memory_id`)
								.bind(timestamp(), claim.memory_id, claim.token)
								.first();
							if (released) retry.push(claim);
						});
						retry.push(...pending.slice(offset + concurrency));
						break;
					}
					try {
						await options.beforeSyncBatch(embeddingClaims.map((claim) => claim.memory_id));
					} catch (error) {
						await concurrent(embeddingClaims, concurrency, (claim) =>
							fail(claim, "backfill", error, retry),
						);
						continue;
					}
					await concurrent(embeddingClaims, concurrency, (claim) =>
						syncAttempt(claim, upserts, deletes, retry, claim),
					);
				}
			} else {
				await concurrent(pending, concurrency, (job) => syncAttempt(job, upserts, deletes, retry));
			}
			await flushReady();
			pending = retry;
		}
	}
	if (store.query) {
		const candidates =
			await env.DB.prepare(`SELECT job.memory_id, job.generation, mv.content_hash, mv.vector, mv.dim
			FROM vector_sync_jobs job JOIN memory_vectors mv ON mv.memory_id = job.memory_id
			JOIN memories memory ON memory.id = job.memory_id
			WHERE job.synced_generation = job.generation AND job.lease_token IS NULL AND job.dead_at IS NULL
			AND (job.visible_generation IS NULL OR job.visible_generation != job.generation)
			AND mv.profile_id = ? AND mv.indexed_at IS NOT NULL AND mv.content_hash = memory.content_hash
			AND memory.deleted_at IS NULL AND (? IS NULL OR job.memory_id IN (SELECT value FROM json_each(?)))
			ORDER BY mv.indexed_at, job.memory_id LIMIT ?`)
				.bind(profileId, target, target, limit)
				.all<{
					memory_id: string;
					generation: number;
					content_hash: string;
					vector: ArrayBuffer;
					dim: number;
				}>();
		await concurrent(candidates.results, concurrency, async (candidate) => {
			try {
				const hits = await store.query?.({
					vector: decodeFloat32Vector(candidate.vector, candidate.dim),
					topK: 50,
					returnMetadata: true,
				});
				if (
					!hits?.some(
						(hit) =>
							hit.id === candidate.memory_id &&
							hit.generation === candidate.generation &&
							hit.content_hash === candidate.content_hash,
					)
				)
					return;
				await env.DB.prepare(`UPDATE vector_sync_jobs SET visible_generation = ?
					WHERE memory_id = ? AND generation = ? AND synced_generation = ? AND lease_token IS NULL`)
					.bind(
						candidate.generation,
						candidate.memory_id,
						candidate.generation,
						candidate.generation,
					)
					.run();
			} catch (error) {
				console.error({ event: "vector_visibility_failed", ...vectorErrorDetails(error) });
			}
		});
	}
	return totals;
}
