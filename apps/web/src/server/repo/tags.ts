import type { VisibleSpaces } from "../auth/authorize";
import { chunkBoundParams, isUniqueConstraint } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";

export const TAG_NAME_MAX = 64;

export function normalizeTag(raw: string): string {
	const name = raw
		.trim()
		.normalize("NFKC")
		.replace(/\p{Script=Latin}/gu, (ch) => ch.toLowerCase());
	if (name.length < 1 || name.length > TAG_NAME_MAX) {
		throw new ApiError("validation_failed", "tag name must be 1-64 characters after normalize");
	}
	return name;
}

export function tagDisplayName(raw: string): string {
	const display = raw.trim().normalize("NFKC");
	if (display.length < 1 || display.length > TAG_NAME_MAX) {
		throw new ApiError("validation_failed", "tag name must be 1-64 characters after normalize");
	}
	return display;
}

export type TagRow = {
	id: string;
	name: string;
	display_name: string;
	merged_into: string | null;
	created_at: number;
	updated_at: number;
};

export type TagCount = {
	id: string;
	name: string;
	display_name: string;
	use_count: number;
};

export class TagRepo {
	constructor(
		private readonly db: D1Database,
		private readonly now: () => number = Date.now,
		private readonly id: () => string = newUlid,
	) {}

	async getByName(name: string): Promise<TagRow | null> {
		return this.db.prepare("SELECT * FROM tags WHERE name = ?").bind(name).first<TagRow>();
	}

	async getById(id: string): Promise<TagRow | null> {
		return this.db.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first<TagRow>();
	}

	async follow(row: TagRow): Promise<TagRow> {
		const seen = new Set<string>();
		let current = row;
		while (current.merged_into) {
			if (seen.has(current.id)) {
				throw new ApiError("unprocessable", "tag merge cycle");
			}
			seen.add(current.id);
			const next = await this.getById(current.merged_into);
			if (!next) {
				throw new ApiError("unprocessable", "tag redirect is broken");
			}
			current = next;
		}
		return current;
	}

	async resolveMany(rawNames: string[]): Promise<TagRow[]> {
		const resolved: TagRow[] = [];
		const seen = new Set<string>();
		for (const raw of rawNames) {
			const name = normalizeTag(raw);
			const display = tagDisplayName(raw);
			const id = this.id();
			const ts = this.now();
			await this.db
				.prepare(
					"INSERT OR IGNORE INTO tags (id, name, display_name, merged_into, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
				)
				.bind(id, name, display, ts, ts)
				.run();
			const row = await this.getByName(name);
			if (!row) {
				throw new ApiError("internal", "failed to resolve tag");
			}
			const canonical = await this.follow(row);
			if (!seen.has(canonical.id)) {
				seen.add(canonical.id);
				resolved.push(canonical);
			}
		}
		return resolved;
	}

	async listWithCounts(visible: VisibleSpaces): Promise<TagCount[]> {
		const { results } = await this.db
			.prepare("SELECT id, name, display_name FROM tags WHERE merged_into IS NULL ORDER BY name")
			.all<{ id: string; name: string; display_name: string }>();
		const tags = results;
		if (visible.kind === "ids" && visible.ids.length === 0) {
			return tags.map((tag) => ({ ...tag, use_count: 0 }));
		}
		const map = new Map<string, number>();
		if (visible.kind === "all") {
			const { results: counts } = await this.db
				.prepare(
					"SELECT mt.tag_id AS tag_id, COUNT(*) AS n FROM memory_tags mt INNER JOIN memories m ON m.id = mt.memory_id WHERE m.deleted_at IS NULL GROUP BY mt.tag_id",
				)
				.all<{ tag_id: string; n: number }>();
			for (const row of counts) {
				map.set(row.tag_id, Number(row.n));
			}
		} else {
			for (const ids of chunkBoundParams(visible.ids)) {
				const placeholders = ids.map(() => "?").join(",");
				const { results: counts } = await this.db
					.prepare(
						`SELECT mt.tag_id AS tag_id, COUNT(*) AS n FROM memory_tags mt INNER JOIN memories m ON m.id = mt.memory_id WHERE m.deleted_at IS NULL AND m.space_id IN (${placeholders}) GROUP BY mt.tag_id`,
					)
					.bind(...ids)
					.all<{ tag_id: string; n: number }>();
				for (const row of counts) {
					map.set(row.tag_id, (map.get(row.tag_id) ?? 0) + Number(row.n));
				}
			}
		}
		return tags.map((tag) => ({ ...tag, use_count: map.get(tag.id) ?? 0 }));
	}

	async rename(fromRaw: string, toRaw: string, actor: string): Promise<TagRow> {
		const fromName = normalizeTag(fromRaw);
		const toName = normalizeTag(toRaw);
		const toDisplay = tagDisplayName(toRaw);
		const from = await this.getByName(fromName);
		if (!from) {
			throw new ApiError("not_found", "not found");
		}
		const existing = await this.getByName(toName);
		if (existing && existing.id !== from.id) {
			throw new ApiError("tag_conflict", "tag name already exists", {
				suggest: "merge",
				into: existing.name,
			});
		}
		const ts = this.now();
		try {
			await this.db.batch([
				this.db
					.prepare("UPDATE tags SET name = ?, display_name = ?, updated_at = ? WHERE id = ?")
					.bind(toName, toDisplay, ts, from.id),
				this.db
					.prepare(
						"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('tag', ?, NULL, 'tag_renamed', NULL, ?, ?)",
					)
					.bind(from.id, actor, ts),
				...this.ftsRebuildStmts(from.id),
			]);
		} catch (err) {
			if (isUniqueConstraint(err, "tags")) {
				throw new ApiError("tag_conflict", "tag name already exists", {
					suggest: "merge",
					into: toName,
				});
			}
			throw err;
		}
		return { ...from, name: toName, display_name: toDisplay, updated_at: ts };
	}

	async merge(
		fromRaw: string,
		intoRaw: string,
		actor: string,
	): Promise<{ from: TagRow; into: TagRow; memories: number }> {
		const fromRow = await this.getByName(normalizeTag(fromRaw));
		const intoRow = await this.getByName(normalizeTag(intoRaw));
		if (!fromRow || !intoRow) {
			throw new ApiError("not_found", "not found");
		}
		const from = await this.follow(fromRow);
		const into = await this.follow(intoRow);
		if (from.id === into.id) {
			throw new ApiError("validation_failed", "cannot merge a tag into itself");
		}
		const ts = this.now();
		const changeInsert = this.db
			.prepare(
				"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) SELECT 'memory', mt.memory_id, m.space_id, 'tag_merged', NULL, ?, ? FROM memory_tags mt INNER JOIN memories m ON m.id = mt.memory_id WHERE mt.tag_id = ?",
			)
			.bind(actor, ts, from.id);
		try {
			const results = await this.db.batch([
				this.db
					.prepare(
						"UPDATE tags SET merged_into = ?, updated_at = ? WHERE id = ? AND merged_into IS NULL AND EXISTS (SELECT 1 FROM tags t WHERE t.id = ? AND t.merged_into IS NULL)",
					)
					.bind(into.id, ts, from.id, into.id),
				this.db
					.prepare(
						"INSERT INTO tags (id, name, display_name, merged_into, created_at, updated_at) SELECT id, name, display_name, merged_into, created_at, updated_at FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM tags WHERE id = ? AND merged_into = ?)",
					)
					.bind(from.id, from.id, into.id),
				changeInsert,
				this.db
					.prepare(
						"DELETE FROM memory_tags WHERE tag_id = ? AND memory_id IN (SELECT memory_id FROM memory_tags WHERE tag_id = ?)",
					)
					.bind(from.id, into.id),
				this.db
					.prepare("UPDATE memory_tags SET tag_id = ? WHERE tag_id = ?")
					.bind(into.id, from.id),
				...this.ftsRebuildStmts(into.id, from.id),
			]);
			const written = results[2] as { meta?: { changes?: number } } | undefined;
			return { from, into, memories: Number(written?.meta?.changes ?? 0) };
		} catch (err) {
			if (String(err).includes("UNIQUE constraint") || String(err).includes("stale_tag_merge")) {
				throw new ApiError("unprocessable", "tag merge is stale");
			}
			throw err;
		}
	}

	private ftsRebuildStmts(...tagIds: string[]): D1PreparedStatement[] {
		const placeholders = tagIds.map(() => "?").join(",");
		const affected = `SELECT DISTINCT memory_id FROM memory_tags WHERE tag_id IN (${placeholders})`;
		const tagSql =
			"IFNULL((SELECT GROUP_CONCAT(t.name, ' ') FROM memory_tags mt INNER JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id = m.id), '')";
		return [
			this.db
				.prepare(
					`DELETE FROM memories_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${affected}))`,
				)
				.bind(...tagIds),
			this.db
				.prepare(
					`INSERT INTO memories_fts(rowid, title, body, tags) SELECT map.fts_rowid, IFNULL(m.title, ''), IFNULL(m.body, ''), ${tagSql} FROM memories m INNER JOIN memories_fts_map map ON map.memory_id = m.id WHERE m.id IN (${affected})`,
				)
				.bind(...tagIds),
			this.db
				.prepare(
					`INSERT INTO memories_fts(rowid, title, body, tags) SELECT (SELECT COALESCE(MAX(fts_rowid), 0) FROM memories_fts_map) + (SELECT COUNT(*) FROM memories m2 WHERE m2.id IN (${affected}) AND NOT EXISTS (SELECT 1 FROM memories_fts_map WHERE memory_id = m2.id) AND m2.id <= m.id), IFNULL(m.title, ''), IFNULL(m.body, ''), ${tagSql} FROM memories m WHERE m.id IN (${affected}) AND NOT EXISTS (SELECT 1 FROM memories_fts_map WHERE memory_id = m.id)`,
				)
				.bind(...tagIds, ...tagIds),
			this.db
				.prepare(
					`INSERT INTO memories_fts_map (memory_id, fts_rowid) SELECT m.id, (SELECT COALESCE(MAX(fts_rowid), 0) FROM memories_fts_map) + (SELECT COUNT(*) FROM memories m2 WHERE m2.id IN (${affected}) AND NOT EXISTS (SELECT 1 FROM memories_fts_map WHERE memory_id = m2.id) AND m2.id <= m.id) FROM memories m WHERE m.id IN (${affected}) AND NOT EXISTS (SELECT 1 FROM memories_fts_map WHERE memory_id = m.id)`,
				)
				.bind(...tagIds, ...tagIds),
		];
	}
}
