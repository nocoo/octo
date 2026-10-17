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

	async listWithCounts(visibleSpaceIds: string[]): Promise<TagCount[]> {
		const { results } = await this.db
			.prepare("SELECT id, name, display_name FROM tags WHERE merged_into IS NULL ORDER BY name")
			.all<{ id: string; name: string; display_name: string }>();
		const tags = results;
		if (visibleSpaceIds.length === 0) {
			return tags.map((tag) => ({ ...tag, use_count: 0 }));
		}
		const placeholders = visibleSpaceIds.map(() => "?").join(",");
		const { results: counts } = await this.db
			.prepare(
				`SELECT mt.tag_id AS tag_id, COUNT(*) AS n FROM memory_tags mt INNER JOIN memories m ON m.id = mt.memory_id WHERE m.deleted_at IS NULL AND m.space_id IN (${placeholders}) GROUP BY mt.tag_id`,
			)
			.bind(...visibleSpaceIds)
			.all<{ tag_id: string; n: number }>();
		const map = new Map(counts.map((row) => [row.tag_id, Number(row.n)]));
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
		await this.db.batch([
			this.db
				.prepare("UPDATE tags SET name = ?, display_name = ?, updated_at = ? WHERE id = ?")
				.bind(toName, toDisplay, ts, from.id),
			this.db
				.prepare(
					"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('tag', ?, NULL, 'tag_renamed', NULL, ?, ?)",
				)
				.bind(from.id, actor, ts),
		]);
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
		const { results } = await this.db
			.prepare(
				"SELECT mt.memory_id AS memory_id, m.space_id AS space_id FROM memory_tags mt INNER JOIN memories m ON m.id = mt.memory_id WHERE mt.tag_id = ?",
			)
			.bind(from.id)
			.all<{ memory_id: string; space_id: string }>();
		const affected = results;
		const ts = this.now();
		const stmts: D1PreparedStatement[] = [
			this.db
				.prepare(
					"DELETE FROM memory_tags WHERE tag_id = ? AND memory_id IN (SELECT memory_id FROM memory_tags WHERE tag_id = ?)",
				)
				.bind(from.id, into.id),
			this.db.prepare("UPDATE memory_tags SET tag_id = ? WHERE tag_id = ?").bind(into.id, from.id),
			this.db
				.prepare("UPDATE tags SET merged_into = ?, updated_at = ? WHERE id = ?")
				.bind(into.id, ts, from.id),
		];
		for (const mem of affected) {
			stmts.push(
				this.db
					.prepare(
						"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('memory', ?, ?, 'tag_merged', NULL, ?, ?)",
					)
					.bind(mem.memory_id, mem.space_id, actor, ts),
			);
		}
		await this.db.batch(stmts);
		return { from, into, memories: affected.length };
	}
}
