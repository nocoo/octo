import type { Env } from "../env";
import { ApiError } from "../lib/errors";

type PurgeSnapshot = {
	version: number;
	space_id: string;
	deleted_at: number | null;
	updated_at: number;
};

async function snapshot(db: D1Database, id: string): Promise<PurgeSnapshot | null> {
	return db
		.prepare("SELECT version, space_id, deleted_at, updated_at FROM memories WHERE id = ?")
		.bind(id)
		.first<PurgeSnapshot>();
}

export async function purgeMemory(
	db: D1Database,
	id: string,
	actor: `admin:${string}`,
): Promise<{ id: string; purged: true }> {
	let current: PurgeSnapshot | null;
	try {
		current = await snapshot(db, id);
	} catch {
		throw new ApiError("unavailable", "purge transaction unavailable");
	}
	if (!current) throw new ApiError("not_found", "not found");
	if (current.deleted_at === null) throw new ApiError("version_conflict", "memory is not trashed");
	const now = Date.now();
	try {
		const statements = [
			db
				.prepare(`INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at)
			VALUES ('memory', CASE WHEN EXISTS (
				SELECT 1 FROM memories WHERE id = ? AND version = ? AND space_id = ? AND deleted_at = ? AND updated_at = ?
			) THEN ? ELSE NULL END, ?, 'purged', ?, ?, ?)`)
				.bind(
					id,
					current.version,
					current.space_id,
					current.deleted_at,
					current.updated_at,
					id,
					current.space_id,
					current.version,
					actor,
					now,
				),
			db
				.prepare(
					"INSERT INTO external_file_cleanup_jobs (r2_key, created_at) SELECT r2_key, ? FROM attachments WHERE memory_id = ? ON CONFLICT(r2_key) DO NOTHING",
				)
				.bind(now, id),
			db
				.prepare(
					"DELETE FROM memories_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id = ?)",
				)
				.bind(id),
			...[
				"memories_fts_map",
				"memory_versions",
				"memory_tags",
				"memory_vectors",
				"attachments",
			].map((table) => db.prepare(`DELETE FROM ${table} WHERE memory_id = ?`).bind(id)),
			db.prepare("DELETE FROM memories WHERE id = ?").bind(id),
		];
		await db.batch(statements);
	} catch {
		let latest: PurgeSnapshot | null;
		try {
			latest = await snapshot(db, id);
		} catch {
			throw new ApiError("unavailable", "purge transaction unavailable");
		}
		if (!latest) throw new ApiError("not_found", "not found");
		if (
			latest.version !== current.version ||
			latest.space_id !== current.space_id ||
			latest.deleted_at !== current.deleted_at ||
			latest.updated_at !== current.updated_at
		)
			throw new ApiError("version_conflict", "memory changed before purge");
		throw new ApiError("unavailable", "purge transaction unavailable");
	}
	return { id, purged: true };
}

export async function cleanupExternalFiles(env: Pick<Env, "DB" | "FILES">): Promise<void> {
	const { results } = await env.DB.prepare(
		"SELECT r2_key FROM external_file_cleanup_jobs ORDER BY last_attempt_at, created_at, r2_key LIMIT 100",
	).all<{ r2_key: string }>();
	for (const job of results) {
		try {
			await env.DB.prepare(
				"UPDATE external_file_cleanup_jobs SET last_attempt_at = ? WHERE r2_key = ?",
			)
				.bind(Date.now(), job.r2_key)
				.run();
			await env.FILES.delete(job.r2_key);
			await env.DB.prepare("DELETE FROM external_file_cleanup_jobs WHERE r2_key = ?")
				.bind(job.r2_key)
				.run();
		} catch {
			console.error("purge file cleanup failed");
		}
	}
}
