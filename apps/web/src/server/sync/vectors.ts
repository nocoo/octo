import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import type { VectorStore } from "../ports/vector/types";
import { decodeFloat32Vector } from "../search/math";
import { createSearchVectorStore } from "../search/vector-store-factory";

export const SYNC_LEASE_MS = 60_000;
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;

type SyncOptions = {
	store?: Pick<VectorStore, "upsert" | "delete">;
	now?: number;
	limit?: number;
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
			.prepare(`UPDATE vector_sync_jobs SET generation = generation + 1, due_at = ?,
			lease_until = CASE WHEN lease_token = ? THEN 0 ELSE lease_until END,
			lease_token = CASE WHEN lease_token = ? THEN NULL ELSE lease_token END WHERE memory_id = ?`)
			.bind(now, token, token, memoryId),
	]);
}

export async function synchronizeVectors(
	env: Env,
	options: SyncOptions = {},
): Promise<{ synced: number; failed: number }> {
	const now = options.now ?? Date.now();
	const limit = Math.max(0, Math.min(100, options.limit ?? 50));
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
		WHERE due_at <= ? AND lease_until <= ? ORDER BY due_at, memory_id LIMIT ?`)
		.bind(now, now, limit)
		.all<{ memory_id: string }>();
	for (const job of jobs.results) {
		const token = crypto.randomUUID();
		const claim =
			await env.DB.prepare(`UPDATE vector_sync_jobs SET lease_token = ?, lease_until = ?, due_at = ?
			WHERE memory_id = ? AND lease_until <= ? AND due_at <= ? RETURNING generation`)
				.bind(token, now + SYNC_LEASE_MS, now, job.memory_id, now, now)
				.first<{ generation: number }>();
		if (!claim) continue;
		try {
			const source =
				await env.DB.prepare(`SELECT m.id, s.slug AS space, m.type, m.source_key_id AS source,
				m.importance, m.created_at AS created, m.updated_at AS updated, m.event_time AS event,
				mv.dim, mv.vector FROM memories m JOIN spaces s ON s.id = m.space_id
				JOIN memory_vectors mv ON mv.memory_id = m.id
				WHERE m.id = ? AND m.deleted_at IS NULL AND mv.profile_id = ?`)
					.bind(job.memory_id, profileId)
					.first<SourceVector>();
			if (source) {
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
				await store.delete([job.memory_id]);
			}
			const results = await env.DB.batch([
				env.DB.prepare(`UPDATE memory_vectors SET indexed_at = ? WHERE memory_id = ? AND profile_id = ?
					AND EXISTS (SELECT 1 FROM vector_sync_jobs WHERE memory_id = ? AND generation = ? AND lease_token = ?)
					AND EXISTS (SELECT 1 FROM memories WHERE id = ? AND deleted_at IS NULL)`).bind(
					now,
					job.memory_id,
					profileId,
					job.memory_id,
					claim.generation,
					token,
					job.memory_id,
				),
				env.DB.prepare(`UPDATE vector_sync_jobs SET synced_generation = generation, lease_token = NULL,
					lease_until = 0, due_at = ? WHERE memory_id = ? AND generation = ? AND lease_token = ?`).bind(
					now + RECONCILE_INTERVAL_MS,
					job.memory_id,
					claim.generation,
					token,
				),
			]);
			if (results[1]?.meta.changes === 1) totals.synced++;
			else await invalidate(env.DB, job.memory_id, token, now);
		} catch {
			totals.failed++;
			console.error("vector_sync_failed");
			await invalidate(env.DB, job.memory_id, token, now);
		}
	}
	return totals;
}
