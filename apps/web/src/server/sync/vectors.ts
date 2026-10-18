import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import type { VectorStore } from "../ports/vector/types";
import { decodeFloat32Vector } from "../search/math";
import { createSearchVectorStore } from "../search/vector-store-factory";
import { vectorErrorDetails } from "./vector-errors";

export const SYNC_LEASE_MS = 60_000;
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_FAILURES = 8;
const DELETE_BATCH_SIZE = 100;

type Job = { memory_id: string };
type Claim = Job & { token: string; generation: number };

async function concurrent<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
	const pending = items.values();
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			for (const item of pending) await work(item);
		}),
	);
}

type SyncOptions = {
	store?: Pick<VectorStore, "upsert" | "delete">;
	now?: number;
	limit?: number;
	beforeSync?: (memoryId: string) => Promise<unknown>;
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
			.prepare(`UPDATE vector_sync_jobs SET generation = generation + 1,
			due_at = CASE WHEN lease_token = ? OR (attempts = 0 AND dead_at IS NULL) THEN ? ELSE due_at END,
			lease_until = CASE WHEN lease_token = ? THEN 0 ELSE lease_until END,
			lease_token = CASE WHEN lease_token = ? THEN NULL ELSE lease_token END WHERE memory_id = ?`)
			.bind(token, now, token, token, memoryId),
	]);
}

export async function synchronizeVectors(
	env: Env,
	options: SyncOptions = {},
): Promise<{ synced: number; failed: number }> {
	const now = options.now ?? Date.now();
	const limit = Math.max(0, Math.min(500, Math.trunc(options.limit ?? 50)));
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
	const jobs = await env.DB.prepare(`SELECT memory_id FROM vector_sync_jobs
		WHERE dead_at IS NULL AND due_at <= ? AND lease_until <= ? ORDER BY due_at, memory_id LIMIT ?`)
		.bind(now, now, limit)
		.all<Job>();
	const fail = async (job: Claim, stage: string, error: unknown) => {
		totals.failed++;
		const details = vectorErrorDetails(error);
		const entry = {
			memory_id: job.memory_id,
			...details,
			message: `Vector synchronization failed during ${stage}`,
		};
		console.error({ event: "vector_sync_failed", ...entry });
		const failed = await env.DB.prepare(`UPDATE vector_sync_jobs SET attempts = attempts + 1,
			last_error = ?, due_at = ? + min(1 << (attempts + 1), 24) * ?,
			dead_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END,
			lease_token = NULL, lease_until = 0
			WHERE memory_id = ? AND generation = ? AND lease_token = ? AND dead_at IS NULL
			RETURNING attempts, dead_at`)
			.bind(
				details.error_message,
				now,
				RECONCILE_INTERVAL_MS,
				MAX_FAILURES,
				now,
				job.memory_id,
				job.generation,
				job.token,
			)
			.first<{ attempts: number; dead_at: number | null }>();
		if (!failed) {
			await invalidate(env.DB, job.memory_id, job.token, now);
			return;
		}
		await env.DB.prepare(`UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = ?
			AND EXISTS (SELECT 1 FROM vector_sync_jobs WHERE memory_id = ? AND generation = ? AND attempts = ?)`)
			.bind(job.memory_id, job.memory_id, job.generation, failed.attempts)
			.run();
		if (failed.dead_at !== null)
			console.error({ event: "vector_sync_dead", ...entry, attempts: failed.attempts });
	};
	const acknowledge = async (job: Claim, retry: Job[]) => {
		const results = await env.DB.batch([
			env.DB.prepare(`UPDATE memory_vectors SET indexed_at = ? WHERE memory_id = ? AND profile_id = ?
				AND EXISTS (SELECT 1 FROM vector_sync_jobs WHERE memory_id = ? AND generation = ? AND lease_token = ?)
				AND EXISTS (SELECT 1 FROM memories WHERE id = ? AND deleted_at IS NULL)`).bind(
				now,
				job.memory_id,
				profileId,
				job.memory_id,
				job.generation,
				job.token,
				job.memory_id,
			),
			env.DB.prepare(`UPDATE vector_sync_jobs SET synced_generation = generation, lease_token = NULL,
				lease_until = 0, due_at = ?, attempts = 0, last_error = NULL, dead_at = NULL
				WHERE memory_id = ? AND generation = ? AND lease_token = ?`).bind(
				now + RECONCILE_INTERVAL_MS,
				job.memory_id,
				job.generation,
				job.token,
			),
		]);
		if (results[1]?.meta.changes === 1) {
			totals.synced++;
		} else {
			await invalidate(env.DB, job.memory_id, job.token, now);
			retry.push(job);
		}
	};
	const syncAttempt = async (job: Job, deletes: Claim[], retry: Job[]) => {
		const token = crypto.randomUUID();
		const claim =
			await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_token = ?, lease_until = ?, due_at = ?
			WHERE memory_id = ? AND dead_at IS NULL AND lease_until <= ? AND due_at <= ? RETURNING generation`)
				.bind(token, now + SYNC_LEASE_MS, now, job.memory_id, now, now)
				.first<{ generation: number }>();
		if (!claim) return;
		const claimed = { ...job, token, generation: claim.generation };
		let stage = "backfill";
		try {
			await options.beforeSync?.(job.memory_id);
			stage = "read";
			const current = await env.DB.prepare(`SELECT generation FROM vector_sync_jobs
				WHERE memory_id = ? AND lease_token = ?`)
				.bind(job.memory_id, token)
				.first<{ generation: number }>();
			if (!current) return;
			claimed.generation = current.generation;
			const source =
				await env.DB.prepare(`SELECT m.id, s.slug AS space, m.type, m.source_key_id AS source,
				m.importance, m.created_at AS created, m.updated_at AS updated, m.event_time AS event,
				mv.dim, mv.vector FROM memories m JOIN spaces s ON s.id = m.space_id
				JOIN memory_vectors mv ON mv.memory_id = m.id
				WHERE m.id = ? AND m.deleted_at IS NULL AND mv.profile_id = ?`)
					.bind(job.memory_id, profileId)
					.first<SourceVector>();
			if (source) {
				stage = "upsert";
				await store.upsert([
					{
						id: source.id,
						values: decodeFloat32Vector(source.vector, source.dim),
						metadata: {
							space: source.space,
							type: source.type,
							source: source.source,
							importance: source.importance,
							created: source.created,
							updated: source.updated,
							...(source.event === null ? {} : { event: source.event }),
						},
					},
				]);
			} else {
				deletes.push(claimed);
				return;
			}
			stage = "acknowledge";
			await acknowledge(claimed, retry);
		} catch (error) {
			await fail(claimed, stage, error);
		}
	};
	for (let offset = 0; offset < jobs.results.length; offset += DELETE_BATCH_SIZE) {
		let pending = jobs.results.slice(offset, offset + DELETE_BATCH_SIZE);
		for (let round = 0; round < 3 && pending.length > 0; round++) {
			const deletes: Claim[] = [];
			const retry: Job[] = [];
			await concurrent(pending, concurrency, (job) => syncAttempt(job, deletes, retry));
			if (deletes.length > 0) {
				try {
					await store.delete(deletes.map((job) => job.memory_id));
				} catch (error) {
					await concurrent(deletes, concurrency, (job) => fail(job, "delete", error));
					pending = retry;
					continue;
				}
				await concurrent(deletes, concurrency, async (job) => {
					try {
						await acknowledge(job, retry);
					} catch (error) {
						await fail(job, "acknowledge", error);
					}
				});
			}
			pending = retry;
		}
	}
	return totals;
}
