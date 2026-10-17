import type { MemoryFilters } from "../../lib/schema/filters";
import type { VisibleSpaces } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import { encodeCursor, type MemoryCursor } from "./memories-cursor";
import type { VectorWrite } from "./memories-vector";

export type MemoryOp = "create" | "update" | "rollback" | "restore" | "move";

export type MemoryRecord = {
	id: string;
	space_id: string;
	space_slug: string;
	title: string;
	body: string;
	type: string;
	importance: number;
	source_key_id: string;
	updated_by_key_id: string | null;
	event_time: number | null;
	version: number;
	content_hash: string;
	created_at: number;
	updated_at: number;
	deleted_at: number | null;
	deleted_by: string | null;
};

export type MemoryWrite = {
	id: string;
	spaceId: string;
	title: string;
	body: string;
	type: string;
	importance: number;
	eventTime: number | null;
	tags: Array<{ id: string; name: string }>;
	actor: string;
	sourceKeyId: string;
	updatedByKeyId: string;
	op: MemoryOp;
	rollbackOf?: number | null;
	expectedVersion?: number;
	vector?: VectorWrite | null;
	now: number;
};

export type ListQuery = {
	filters: MemoryFilters;
	visible: VisibleSpaces;
	spaceIds?: string[] | undefined;
	tagAllIds?: string[] | undefined;
	tagAnyIds?: string[] | undefined;
	includeTrashed?: boolean | undefined;
	trashedOnly?: boolean | undefined;
	ownSourceKeyId?: string | undefined;
	cursor?: MemoryCursor | undefined;
	limit: number;
};

const SELECT_MEMORY = `SELECT m.id, m.space_id, s.slug AS space_slug, m.title, m.body, m.type, m.importance,
  m.source_key_id, m.updated_by_key_id, m.event_time, m.version, m.content_hash,
  m.created_at, m.updated_at, m.deleted_at, m.deleted_by
FROM memories m INNER JOIN spaces s ON s.id = m.space_id`;

export async function contentHash(title: string, body: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(title + body));
	const bytes = new Uint8Array(digest);
	let out = "";
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

function changeOp(op: MemoryOp): string {
	if (op === "create") {
		return "created";
	}
	if (op === "update") {
		return "updated";
	}
	if (op === "rollback") {
		return "rolled_back";
	}
	if (op === "restore") {
		return "restored";
	}
	return "moved";
}

function firstChanges(result: unknown): number {
	const row = result as { meta?: { changes?: number } } | undefined;
	return Number(row?.meta?.changes ?? 0);
}

export class MemoryRepo {
	constructor(private readonly db: D1Database) {}

	async spaceBySlug(slug: string): Promise<{ id: string; slug: string; name: string } | null> {
		return this.db
			.prepare("SELECT id, slug, name FROM spaces WHERE slug = ?")
			.bind(slug)
			.first<{ id: string; slug: string; name: string }>();
	}

	async get(id: string): Promise<MemoryRecord | null> {
		return this.db.prepare(`${SELECT_MEMORY} WHERE m.id = ?`).bind(id).first<MemoryRecord>();
	}

	async tagNamesByMemory(ids: string[]): Promise<Map<string, string[]>> {
		const map = new Map<string, string[]>();
		if (ids.length === 0) {
			return map;
		}
		const placeholders = ids.map(() => "?").join(",");
		const { results } = await this.db
			.prepare(
				`SELECT mt.memory_id AS memory_id, t.name AS name FROM memory_tags mt INNER JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id IN (${placeholders}) ORDER BY t.name`,
			)
			.bind(...ids)
			.all<{ memory_id: string; name: string }>();
		for (const row of results) {
			const list = map.get(row.memory_id) ?? [];
			list.push(row.name);
			map.set(row.memory_id, list);
		}
		return map;
	}

	async versionsCount(id: string): Promise<number> {
		const row = await this.db
			.prepare("SELECT COUNT(*) AS n FROM memory_versions WHERE memory_id = ?")
			.bind(id)
			.first<{ n: number }>();
		return Number(row?.n ?? 0);
	}

	async attachments(id: string): Promise<
		Array<{
			id: string;
			filename: string;
			content_type: string;
			size_bytes: number;
			sha256: string;
			created_at: number;
		}>
	> {
		const { results } = await this.db
			.prepare(
				"SELECT id, filename, content_type, size_bytes, sha256, created_at FROM attachments WHERE memory_id = ? AND deleted_at IS NULL ORDER BY created_at",
			)
			.bind(id)
			.all<{
				id: string;
				filename: string;
				content_type: string;
				size_bytes: number;
				sha256: string;
				created_at: number;
			}>();
		return results;
	}

	async vectorStatus(
		id: string,
		contentHashValue: string,
	): Promise<Array<{ profile: string; indexed: boolean; stale: boolean }>> {
		const { results } = await this.db
			.prepare(
				"SELECT profile_id AS profile, indexed_at, content_hash FROM memory_vectors WHERE memory_id = ?",
			)
			.bind(id)
			.all<{ profile: string; indexed_at: number | null; content_hash: string }>();
		return results.map((row) => ({
			profile: row.profile,
			indexed: row.indexed_at != null,
			stale: row.content_hash !== contentHashValue,
		}));
	}

	async write(input: MemoryWrite): Promise<MemoryRecord> {
		const nextVersion = input.expectedVersion == null ? 1 : input.expectedVersion + 1;
		const hash = await contentHash(input.title, input.body);
		const stmts = [
			...this.rowStmts(input, nextVersion, hash),
			this.versionStmt(input, nextVersion),
			...this.tagStmts(input, nextVersion),
			...this.ftsStmts(input.id, nextVersion, input.now),
			this.changeStmt(input, nextVersion),
			...this.vectorStmts(input, nextVersion, hash),
		];
		let results: unknown[];
		try {
			results = await this.db.batch(stmts);
		} catch (err) {
			const current = await this.get(input.id);
			if (
				current &&
				input.expectedVersion != null &&
				(current.version !== input.expectedVersion || current.updated_at !== input.now)
			) {
				throw new ApiError(
					"version_conflict",
					`memory ${input.id} is at version ${current.version}, expected ${input.expectedVersion}`,
					{ current_version: current.version },
				);
			}
			throw err;
		}
		if (firstChanges(results[0]) === 0) {
			const current = await this.get(input.id);
			if (!current || (input.op !== "restore" && current.deleted_at != null)) {
				throw new ApiError("not_found", "not found");
			}
			throw new ApiError(
				"version_conflict",
				`memory ${input.id} is at version ${current.version}, expected ${input.expectedVersion}`,
				{ current_version: current.version },
			);
		}
		const row = await this.get(input.id);
		if (!row) {
			throw new ApiError("internal", "memory write did not persist");
		}
		return row;
	}

	async trash(id: string, actor: string, now: number): Promise<MemoryRecord> {
		const results = await this.db.batch([
			this.db
				.prepare(
					"UPDATE memories SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
				)
				.bind(now, actor, now, id),
			this.db
				.prepare(
					"DELETE FROM memories_fts WHERE rowid IN (SELECT map.fts_rowid FROM memories_fts_map map INNER JOIN memories m ON m.id = map.memory_id WHERE m.id = ? AND m.deleted_at IS NOT NULL)",
				)
				.bind(id),
			this.db
				.prepare(
					"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) SELECT 'memory', id, space_id, 'trashed', version, ?, ? FROM memories WHERE id = ? AND deleted_at IS NOT NULL",
				)
				.bind(actor, now, id),
		]);
		if (firstChanges(results[0]) === 0) {
			throw new ApiError("not_found", "not found");
		}
		const row = await this.get(id);
		if (!row) {
			throw new ApiError("internal", "trash did not persist");
		}
		return row;
	}

	async list(query: ListQuery): Promise<{ items: MemoryRecord[]; next_cursor: string | null }> {
		if (query.visible.kind === "ids" && query.visible.ids.length === 0) {
			return { items: [], next_cursor: null };
		}
		if (query.spaceIds && query.spaceIds.length === 0) {
			return { items: [], next_cursor: null };
		}
		if (query.tagAllIds && query.tagAllIds.length === 0) {
			return { items: [], next_cursor: null };
		}
		if (query.tagAnyIds && query.tagAnyIds.length === 0) {
			return { items: [], next_cursor: null };
		}
		const { sql, binds } = this.listSql(query);
		const { results } = await this.db
			.prepare(`${SELECT_MEMORY} ${sql} ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`)
			.bind(...binds, query.limit + 1)
			.all<MemoryRecord>();
		const extra = results.length > query.limit;
		const items = extra ? results.slice(0, query.limit) : results;
		const last = items[items.length - 1];
		return {
			items,
			next_cursor: extra && last ? encodeCursor({ u: last.updated_at, i: last.id }) : null,
		};
	}

	private rowStmts(input: MemoryWrite, version: number, hash: string): D1PreparedStatement[] {
		if (input.op === "create") {
			return [
				this.db
					.prepare(
						`INSERT INTO memories (
              id, space_id, title, body, type, importance, source_key_id, updated_by_key_id,
              event_time, version, content_hash, created_at, updated_at, deleted_at, deleted_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL)`,
					)
					.bind(
						input.id,
						input.spaceId,
						input.title,
						input.body,
						input.type,
						input.importance,
						input.sourceKeyId,
						input.updatedByKeyId,
						input.eventTime,
						hash,
						input.now,
						input.now,
					),
			];
		}
		if (input.op === "restore") {
			return [
				this.db
					.prepare(
						"UPDATE memories SET deleted_at = NULL, deleted_by = NULL, version = ?, updated_at = ?, updated_by_key_id = ? WHERE id = ? AND version = ? AND deleted_at IS NOT NULL",
					)
					.bind(version, input.now, input.updatedByKeyId, input.id, input.expectedVersion ?? 0),
			];
		}
		return [
			this.db
				.prepare(
					`UPDATE memories SET
            space_id = ?, title = ?, body = ?, type = ?, importance = ?,
            updated_by_key_id = ?, event_time = ?, version = ?, content_hash = ?, updated_at = ?
          WHERE id = ? AND version = ? AND deleted_at IS NULL`,
				)
				.bind(
					input.spaceId,
					input.title,
					input.body,
					input.type,
					input.importance,
					input.updatedByKeyId,
					input.eventTime,
					version,
					hash,
					input.now,
					input.id,
					input.expectedVersion ?? 0,
				),
		];
	}

	private versionStmt(input: MemoryWrite, version: number): D1PreparedStatement {
		return this.db
			.prepare(
				`INSERT INTO memory_versions (
          memory_id, version, title, body, type, importance, tags_json, event_time,
          space_id, actor, op, rollback_of, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM memories WHERE id = ? AND version = ? AND updated_at = ?)`,
			)
			.bind(
				input.id,
				version,
				input.title,
				input.body,
				input.type,
				input.importance,
				JSON.stringify(input.tags.map((tag) => tag.name)),
				input.eventTime,
				input.spaceId,
				input.actor,
				input.op,
				input.rollbackOf ?? null,
				input.now,
				input.id,
				version,
				input.now,
			);
	}

	private tagStmts(input: MemoryWrite, version: number): D1PreparedStatement[] {
		const del = this.db
			.prepare(
				"DELETE FROM memory_tags WHERE memory_id = ? AND EXISTS (SELECT 1 FROM memories WHERE id = ? AND version = ? AND updated_at = ?)",
			)
			.bind(input.id, input.id, version, input.now);
		if (input.tags.length === 0) {
			return [del];
		}
		const selects = input.tags.map(() => "SELECT ? AS memory_id, ? AS tag_id").join(" UNION ALL ");
		const binds: unknown[] = [];
		for (const tag of input.tags) {
			binds.push(input.id, tag.id);
		}
		return [
			del,
			this.db
				.prepare(
					`INSERT INTO memory_tags (memory_id, tag_id) SELECT v.memory_id, v.tag_id FROM (${selects}) AS v WHERE EXISTS (SELECT 1 FROM memories WHERE id = ? AND version = ? AND updated_at = ?)`,
				)
				.bind(...binds, input.id, version, input.now),
		];
	}

	private ftsStmts(id: string, version: number, now: number): D1PreparedStatement[] {
		const tagsSql =
			"IFNULL((SELECT GROUP_CONCAT(t.name, ' ') FROM memory_tags mt INNER JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id = m.id), '')";
		const wrote = "m.id = ? AND m.version = ? AND m.updated_at = ?";
		return [
			this.db
				.prepare(
					`DELETE FROM memories_fts WHERE rowid IN (SELECT map.fts_rowid FROM memories_fts_map map INNER JOIN memories m ON m.id = map.memory_id WHERE ${wrote})`,
				)
				.bind(id, version, now),
			this.db
				.prepare(
					`INSERT INTO memories_fts(rowid, title, body, tags) SELECT map.fts_rowid, m.title, m.body, ${tagsSql} FROM memories m INNER JOIN memories_fts_map map ON map.memory_id = m.id WHERE ${wrote}`,
				)
				.bind(id, version, now),
			this.db
				.prepare(
					`INSERT INTO memories_fts(rowid, title, body, tags) SELECT (SELECT COALESCE(MAX(fts_rowid), 0) FROM memories_fts_map) + 1, m.title, m.body, ${tagsSql} FROM memories m WHERE ${wrote} AND NOT EXISTS (SELECT 1 FROM memories_fts_map WHERE memory_id = m.id)`,
				)
				.bind(id, version, now),
			this.db
				.prepare(
					`INSERT INTO memories_fts_map (memory_id, fts_rowid) SELECT m.id, (SELECT COALESCE(MAX(fts_rowid), 0) FROM memories_fts_map) + 1 FROM memories m WHERE ${wrote} AND NOT EXISTS (SELECT 1 FROM memories_fts_map WHERE memory_id = m.id)`,
				)
				.bind(id, version, now),
		];
	}

	private changeStmt(input: MemoryWrite, version: number): D1PreparedStatement {
		return this.db
			.prepare(
				"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) SELECT 'memory', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM memories WHERE id = ? AND version = ? AND updated_at = ?)",
			)
			.bind(
				input.id,
				input.spaceId,
				changeOp(input.op),
				version,
				input.actor,
				input.now,
				input.id,
				version,
				input.now,
			);
	}

	private vectorStmts(input: MemoryWrite, version: number, hash: string): D1PreparedStatement[] {
		if (input.vector === undefined) {
			return [];
		}
		if (input.vector === null) {
			return [
				this.db
					.prepare(
						"DELETE FROM memory_vectors WHERE memory_id = ? AND EXISTS (SELECT 1 FROM memories WHERE id = ? AND version = ? AND updated_at = ?)",
					)
					.bind(input.id, input.id, version, input.now),
			];
		}
		const vector = input.vector;
		return [
			this.db
				.prepare(
					`INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, indexed_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM memories WHERE id = ? AND version = ? AND updated_at = ?)
           ON CONFLICT(memory_id, profile_id) DO UPDATE SET
             embedding_model = excluded.embedding_model,
             dim = excluded.dim,
             vector = excluded.vector,
             content_hash = excluded.content_hash,
             indexed_at = NULL,
             updated_at = excluded.updated_at`,
				)
				.bind(
					input.id,
					vector.profileId,
					vector.embeddingModel,
					vector.dim,
					vector.vector,
					hash,
					input.now,
					input.id,
					version,
					input.now,
				),
		];
	}

	private listSql(query: ListQuery): { sql: string; binds: unknown[] } {
		const where: string[] = [];
		const binds: unknown[] = [];
		if (query.trashedOnly) {
			where.push("m.deleted_at IS NOT NULL");
		} else if (!query.includeTrashed) {
			where.push("m.deleted_at IS NULL");
		}
		if (query.visible.kind === "ids") {
			where.push(`m.space_id IN (${query.visible.ids.map(() => "?").join(",")})`);
			binds.push(...query.visible.ids);
		}
		if (query.spaceIds) {
			where.push(`m.space_id IN (${query.spaceIds.map(() => "?").join(",")})`);
			binds.push(...query.spaceIds);
		}
		if (query.ownSourceKeyId) {
			where.push("m.source_key_id = ?");
			binds.push(query.ownSourceKeyId);
		}
		const types = query.filters.types;
		if (types && types.length > 0) {
			where.push(`m.type IN (${types.map(() => "?").join(",")})`);
			binds.push(...types);
		}
		const sources = query.filters.sources;
		if (sources && sources.length > 0) {
			where.push(`m.source_key_id IN (${sources.map(() => "?").join(",")})`);
			binds.push(...sources);
		}
		if (query.tagAllIds) {
			for (const tagId of query.tagAllIds) {
				where.push(
					"EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = m.id AND mt.tag_id = ?)",
				);
				binds.push(tagId);
			}
		}
		if (query.tagAnyIds) {
			where.push(
				`EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = m.id AND mt.tag_id IN (${query.tagAnyIds.map(() => "?").join(",")}))`,
			);
			binds.push(...query.tagAnyIds);
		}
		const time = query.filters.time;
		if (time) {
			const column =
				time.field === "created"
					? "m.created_at"
					: time.field === "event"
						? "m.event_time"
						: "m.updated_at";
			if (time.from) {
				where.push(`${column} >= ?`);
				binds.push(Date.parse(time.from));
			}
			if (time.to) {
				where.push(`${column} <= ?`);
				binds.push(Date.parse(time.to));
			}
		}
		const importance = query.filters.importance;
		if (importance?.min != null) {
			where.push("m.importance >= ?");
			binds.push(importance.min);
		}
		if (importance?.max != null) {
			where.push("m.importance <= ?");
			binds.push(importance.max);
		}
		if (query.cursor) {
			where.push("(m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))");
			binds.push(query.cursor.u, query.cursor.u, query.cursor.i);
		}
		return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", binds };
	}
}
