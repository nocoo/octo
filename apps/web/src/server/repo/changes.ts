import type { VisibleSpaces } from "../auth/authorize";
import { type ChangeCursor, encodeCursor } from "./memories-cursor";

export type ChangeRow = {
	seq: number;
	entity: string;
	entity_id: string;
	space_id: string | null;
	op: string;
	version: number | null;
	actor: string;
	at: number;
};

const DELETE_OPS = new Set(["trashed", "purged"]);

export class ChangeRepo {
	constructor(private readonly db: D1Database) {}

	async head(visible: VisibleSpaces, spaceIds?: string[] | undefined): Promise<number> {
		if (visible.kind === "ids" && visible.ids.length === 0) {
			return 0;
		}
		if (spaceIds && spaceIds.length === 0) {
			return 0;
		}
		const { sql, binds } = this.filterSql(visible, spaceIds, null);
		const row = await this.db
			.prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM changes ${sql}`)
			.bind(...binds)
			.first<{ s: number }>();
		return Number(row?.s ?? 0);
	}

	async list(
		visible: VisibleSpaces,
		opts: { cursor?: ChangeCursor | undefined; limit: number; spaceIds?: string[] | undefined },
	): Promise<{ items: ChangeRow[]; next_cursor: string | null }> {
		if (visible.kind === "ids" && visible.ids.length === 0) {
			return { items: [], next_cursor: null };
		}
		if (opts.spaceIds && opts.spaceIds.length === 0) {
			return { items: [], next_cursor: null };
		}
		const { sql, binds } = this.filterSql(visible, opts.spaceIds, opts.cursor ?? null);
		const { results } = await this.db
			.prepare(`SELECT * FROM changes ${sql} ORDER BY seq ASC LIMIT ?`)
			.bind(...binds, opts.limit + 1)
			.all<ChangeRow>();
		const extra = results.length > opts.limit;
		const items = extra ? results.slice(0, opts.limit) : results;
		const last = items[items.length - 1];
		return {
			items,
			next_cursor: extra && last ? encodeCursor({ s: last.seq }) : null,
		};
	}

	publicItem(row: ChangeRow): Record<string, unknown> {
		const base: Record<string, unknown> = {
			seq: row.seq,
			entity: row.entity,
			entity_id: row.entity_id,
			op: row.op,
			at: new Date(row.at).toISOString(),
		};
		if (DELETE_OPS.has(row.op)) {
			return base;
		}
		base.space_id = row.space_id;
		base.version = row.version;
		base.actor = row.actor;
		return base;
	}

	private filterSql(
		visible: VisibleSpaces,
		spaceIds: string[] | undefined,
		cursor: ChangeCursor | null,
	): { sql: string; binds: unknown[] } {
		const where: string[] = [];
		const binds: unknown[] = [];
		if (visible.kind === "ids") {
			where.push("space_id IN (SELECT value FROM json_each(?))");
			binds.push(JSON.stringify(visible.ids));
		}
		if (spaceIds) {
			where.push("space_id IN (SELECT value FROM json_each(?))");
			binds.push(JSON.stringify(spaceIds));
		}
		if (cursor) {
			where.push("seq > ?");
			binds.push(cursor.s);
		}
		return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", binds };
	}
}
