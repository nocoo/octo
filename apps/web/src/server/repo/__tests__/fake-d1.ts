export type TagRec = {
	id: string;
	name: string;
	display_name: string;
	merged_into: string | null;
	created_at: number;
	updated_at: number;
};

export type SpaceRec = {
	id: string;
	slug: string;
	name: string;
	description: string;
	owner_key_id: string | null;
	created_at: number;
	updated_at: number;
};

export type KeyRec = {
	id: string;
	name: string;
	secret_hash: string;
	prev_secret_hash: string | null;
	prev_valid_until: number | null;
	role: string;
	ops: string;
	scope: string;
	space_ids_json: string;
	own_entries_only: number;
	auto_own_space: number;
	expires_at: number | null;
	revoked_at: number | null;
	last_used_at: number | null;
	created_at: number;
	updated_at: number;
};

type Stmt = {
	sql: string;
	binds: unknown[];
	bind: (...args: unknown[]) => Stmt;
	first: <T>() => Promise<T | null>;
	all: <T>() => Promise<{ results: T[] }>;
	run: () => Promise<{ success: true }>;
};

export class FakeD1 {
	tags = new Map<string, TagRec>();
	spaces = new Map<string, SpaceRec>();
	keys = new Map<string, KeyRec>();
	memories = new Map<
		string,
		{ id: string; space_id: string; deleted_at: number | null; title?: string; body?: string }
	>();
	memoryTags: Array<{ memory_id: string; tag_id: string }> = [];
	changes: Array<Record<string, unknown>> = [];
	fts = new Map<string, string>();
	hiddenNames = new Set<string>();
	blockMerge = false;
	hideSlug = false;

	prepare(sql: string): Stmt {
		const self = this;
		const stmt: Stmt = {
			sql,
			binds: [],
			bind(...args: unknown[]) {
				this.binds = args;
				return this;
			},
			async first() {
				const { results } = await this.all();
				return (results[0] ?? null) as never;
			},
			async all() {
				return { results: self.exec(this.sql, this.binds) as never[] };
			},
			async run() {
				await this.all();
				return { success: true as const };
			},
		};
		return stmt;
	}

	async batch(stmts: Array<{ run: () => Promise<unknown> }>): Promise<unknown[]> {
		const out: unknown[] = [];
		for (const stmt of stmts) {
			out.push(await stmt.run());
		}
		return out;
	}

	exec(sql: string, binds: unknown[]): unknown[] {
		if (sql.includes("INSERT OR IGNORE INTO tags")) {
			const [id, name, display, created, updated] = binds as [
				string,
				string,
				string,
				number,
				number,
			];
			if (![...this.tags.values()].some((t) => t.name === name)) {
				this.tags.set(id, {
					id,
					name,
					display_name: display,
					merged_into: null,
					created_at: created,
					updated_at: updated,
				});
			}
			return [];
		}
		if (sql.includes("INSERT INTO tags")) {
			const [id, name, display, created, updated] = binds as [
				string,
				string,
				string,
				number,
				number,
			];
			this.tags.set(id, {
				id,
				name,
				display_name: display,
				merged_into: null,
				created_at: created,
				updated_at: updated,
			});
			return [];
		}
		if (sql.includes("FROM tags WHERE name = ?")) {
			const name = String(binds[0]);
			if (this.hiddenNames.has(name)) {
				return [];
			}
			const found = [...this.tags.values()].find((t) => t.name === name);
			return found ? [found] : [];
		}
		if (sql.includes("SELECT 1 / CASE WHEN")) {
			const fromId = String(binds[0]);
			const intoId = String(binds[1]);
			const tag = this.tags.get(fromId);
			if (tag?.merged_into !== intoId) {
				throw new Error("stale_tag_merge");
			}
			return [{ 1: 1 }];
		}
		if (sql.includes("FROM tags WHERE id = ?")) {
			const found = this.tags.get(String(binds[0]));
			return found ? [found] : [];
		}
		if (sql.includes("FROM tags WHERE merged_into IS NULL")) {
			return [...this.tags.values()]
				.filter((t) => t.merged_into === null)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((t) => ({ id: t.id, name: t.name, display_name: t.display_name }));
		}
		if (sql.includes("FROM memory_tags mt INNER JOIN memories m") && sql.includes("GROUP BY")) {
			const visible = new Set(binds.map(String));
			const counts = new Map<string, number>();
			for (const link of this.memoryTags) {
				const mem = this.memories.get(link.memory_id);
				if (!mem || mem.deleted_at !== null || !visible.has(mem.space_id)) {
					continue;
				}
				counts.set(link.tag_id, (counts.get(link.tag_id) ?? 0) + 1);
			}
			return [...counts.entries()].map(([tag_id, n]) => ({ tag_id, n }));
		}
		if (sql.includes("SELECT mt.memory_id")) {
			const tagId = String(binds[0]);
			return this.memoryTags
				.filter((link) => link.tag_id === tagId)
				.flatMap((link) => {
					const mem = this.memories.get(link.memory_id);
					return mem ? [{ memory_id: mem.id, space_id: mem.space_id }] : [];
				});
		}
		if (sql.includes("UPDATE tags SET name = ?")) {
			const [name, display, updated, id] = binds as [string, string, number, string];
			const clash = [...this.tags.values()].find((t) => t.name === name && t.id !== id);
			if (clash) {
				throw new Error("UNIQUE constraint failed: tags.name");
			}
			const tag = this.tags.get(id);
			if (tag) {
				tag.name = name;
				tag.display_name = display;
				tag.updated_at = updated;
			}
			return [];
		}
		if (sql.includes("UPDATE tags SET merged_into = ?")) {
			const [into, updated, id, intoCheck] = binds as [string, number, string, string?];
			const tag = this.tags.get(id);
			const target = this.tags.get(intoCheck ?? into);
			if (
				!this.blockMerge &&
				tag &&
				tag.merged_into === null &&
				target &&
				target.merged_into === null
			) {
				tag.merged_into = into;
				tag.updated_at = updated;
			}
			return [];
		}
		if (sql.includes("INSERT INTO changes") && sql.includes("SELECT 'memory'")) {
			const [actor, ts, fromId] = binds as [string, number, string];
			for (const link of this.memoryTags) {
				if (link.tag_id !== fromId) {
					continue;
				}
				const mem = this.memories.get(link.memory_id);
				if (mem) {
					this.changes.push({
						op: "tag_merged",
						entity_id: mem.id,
						space_id: mem.space_id,
						actor,
						at: ts,
					});
				}
			}
			return [];
		}
		if (sql.includes("FROM changes WHERE op = 'tag_merged'")) {
			const [actor, ts] = binds as [string, number];
			const n = this.changes.filter(
				(row) => row.op === "tag_merged" && row.actor === actor && row.at === ts,
			).length;
			return [{ n }];
		}
		if (sql.includes("SELECT DISTINCT memory_id")) {
			const tagIds = new Set(binds.map(String));
			const ids = [
				...new Set(
					this.memoryTags.filter((link) => tagIds.has(link.tag_id)).map((link) => link.memory_id),
				),
			];
			return ids.map((id) => ({ id }));
		}
		if (sql.includes("INSERT OR REPLACE INTO memories_fts_map")) {
			return [];
		}
		if (sql.includes("DELETE FROM memories_fts_map")) {
			return [];
		}
		if (sql.includes("DELETE FROM memories_fts")) {
			const tagIds = new Set(binds.map(String));
			for (const link of this.memoryTags) {
				if (tagIds.has(link.tag_id)) {
					this.fts.delete(link.memory_id);
				}
			}
			return [];
		}
		if (sql.includes("INSERT INTO memories_fts")) {
			const memId = String(binds[0]);
			const names = this.memoryTags
				.filter((link) => link.memory_id === memId)
				.map((link) => this.tags.get(link.tag_id)?.name)
				.filter((name): name is string => Boolean(name));
			this.fts.set(memId, names.join(" "));
			return [];
		}
		if (sql.includes("DELETE FROM memory_tags WHERE tag_id = ? AND memory_id IN")) {
			const [fromId, intoId] = binds.map(String);
			const intoMems = new Set(
				this.memoryTags.filter((l) => l.tag_id === intoId).map((l) => l.memory_id),
			);
			this.memoryTags = this.memoryTags.filter(
				(l) => !(l.tag_id === fromId && intoMems.has(l.memory_id)),
			);
			return [];
		}
		if (sql.includes("UPDATE memory_tags SET tag_id = ? WHERE tag_id = ?")) {
			const intoId = String(binds[0]);
			const fromId = String(binds[1]);
			for (const link of this.memoryTags) {
				if (link.tag_id === fromId) {
					link.tag_id = intoId;
				}
			}
			return [];
		}
		if (sql.includes("INSERT INTO changes")) {
			this.changes.push({ sql, binds: [...binds] });
			return [];
		}
		if (sql.includes("INSERT INTO spaces") && sql.includes("ON CONFLICT")) {
			const [id, slug, name, description, owner, created, updated] = binds as [
				string,
				string,
				string,
				string,
				string | null,
				number,
				number,
			];
			if ([...this.spaces.values()].some((space) => space.slug === slug)) {
				return [];
			}
			this.spaces.set(id, {
				id,
				slug,
				name,
				description,
				owner_key_id: owner,
				created_at: created,
				updated_at: updated,
			});
			return [];
		}
		if (sql.includes("INSERT INTO spaces")) {
			const [id, slug, name, description, owner, created, updated] = binds as [
				string,
				string,
				string,
				string,
				string | null,
				number,
				number,
			];
			this.spaces.set(id, {
				id,
				slug,
				name,
				description,
				owner_key_id: owner,
				created_at: created,
				updated_at: updated,
			});
			return [];
		}
		if (sql.includes("FROM spaces WHERE owner_key_id = ?")) {
			return [...this.spaces.values()].filter((s) => s.owner_key_id === binds[0]);
		}
		if (sql.includes("FROM spaces WHERE slug = ?")) {
			if (this.hideSlug) {
				return [];
			}
			const found = [...this.spaces.values()].find((s) => s.slug === binds[0]);
			return found ? [found] : [];
		}
		if (sql.includes("FROM spaces WHERE id IN")) {
			const ids = new Set(binds.map(String));
			return [...this.spaces.values()]
				.filter((s) => ids.has(s.id))
				.sort((a, b) => a.slug.localeCompare(b.slug));
		}
		if (sql.includes("SELECT id FROM spaces")) {
			return [...this.spaces.values()].map((s) => ({ id: s.id }));
		}
		if (sql.includes("FROM memories WHERE deleted_at IS NULL AND space_id IN")) {
			const ids = new Set(binds.map(String));
			const counts = new Map<string, number>();
			for (const mem of this.memories.values()) {
				if (mem.deleted_at === null && ids.has(mem.space_id)) {
					counts.set(mem.space_id, (counts.get(mem.space_id) ?? 0) + 1);
				}
			}
			return [...counts.entries()].map(([space_id, n]) => ({ space_id, n }));
		}
		if (sql.includes("FROM memories WHERE space_id = ? AND deleted_at IS NULL")) {
			const n = [...this.memories.values()].filter(
				(m) => m.space_id === binds[0] && m.deleted_at === null,
			).length;
			return [{ n }];
		}
		if (sql.includes("UPDATE api_keys SET last_used_at")) {
			return [];
		}
		if (sql.includes("FROM api_keys WHERE id = ?")) {
			const found = this.keys.get(String(binds[0]));
			return found ? [found] : [];
		}
		throw new Error(`unhandled sql: ${sql}`);
	}
}

export function asD1(fake: FakeD1): D1Database {
	return fake as unknown as D1Database;
}
