import { z } from "zod";
import { pageFields, readQuery } from "../audit/query";
import type { Env } from "../env";
import { cursorSecretFromEnv, decodeCursor, encodeCursor } from "../http/cursor";
import { ApiError } from "../lib/errors";
import { parseStrict } from "../lib/validate";
import type { MemoryRecord } from "../repo/memories";
import { publicMemory } from "../services/memories";

export const EMPTY_BATCH_SIZE = 10;
export const trashFiltersSchema = z.strictObject({
	q: z.string().trim().max(500).optional(),
	space: z.string().min(1).max(64).optional(),
});
const querySchema = trashFiltersSchema.extend({
	...pageFields,
	limit: pageFields.limit.default(25),
});
const idSchema = z.string().min(1).max(64);
export const idsSchema = z
	.strictObject({ ids: z.array(idSchema).min(1) })
	.refine(({ ids }) => new Set(ids).size === ids.length, { message: "duplicate ids" });
export const emptySchema = z.strictObject({
	filters: trashFiltersSchema.optional(),
	expected_count: z.number().int().nonnegative().optional(),
	cursor: pageFields.cursor,
});
const cursorSchema = z.strictObject({
	kind: z.enum(["trash-list", "trash-empty"]),
	filter: z.string(),
	head: z.number().int().nonnegative(),
	total: z.number().int().nonnegative(),
	after: idSchema.optional(),
	ids: z.array(idSchema).min(1).max(EMPTY_BATCH_SIZE).optional(),
});
type Filters = z.infer<typeof trashFiltersSchema>;
export type TrashCursor = z.infer<typeof cursorSchema>;

export function unchangedTrashSql(alias = "m"): string {
	return `NOT EXISTS (SELECT 1 FROM changes c WHERE c.seq > ? AND (
		(c.entity = 'memory' AND c.entity_id = ${alias}.id) OR
		(c.entity = 'space' AND c.entity_id = ${alias}.space_id) OR
		(c.entity = 'tag' AND c.entity_id IN (SELECT tag_id FROM memory_tags WHERE memory_id = ${alias}.id))))`;
}

function selection(filters: Filters, head?: number, after?: string) {
	const clauses = ["m.deleted_at IS NOT NULL"];
	const values: (string | number)[] = [];
	if (filters.q) {
		clauses.push(`(instr(lower(m.title), lower(?)) > 0 OR EXISTS (
			SELECT 1 FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id
			WHERE mt.memory_id = m.id AND instr(lower(t.name), lower(?)) > 0))`);
		values.push(filters.q, filters.q);
	}
	if (filters.space) {
		clauses.push("s.slug = ?");
		values.push(filters.space);
	}
	if (head !== undefined) {
		clauses.push(unchangedTrashSql());
		values.push(head);
	}
	if (after) {
		clauses.push("m.id < ?");
		values.push(after);
	}
	return {
		sql: `FROM memories m JOIN spaces s ON s.id = m.space_id WHERE ${clauses.join(" AND ")}`,
		values,
	};
}

export async function trashSnapshot(
	env: Env,
	filters: Filters,
	kind: TrashCursor["kind"],
	raw?: string,
) {
	const filter = JSON.stringify([filters.q || "", filters.space ?? ""]);
	if (raw) {
		const cursor = parseStrict(cursorSchema, await decodeCursor(cursorSecretFromEnv(env), raw));
		if (cursor.filter !== filter || cursor.kind !== kind || (kind === "trash-empty" && !cursor.ids))
			throw new ApiError("validation_failed", "cursor filter mismatch");
		return cursor;
	}
	const where = selection(filters);
	const row = await env.DB.prepare(`SELECT COALESCE(MAX(seq), 0) AS head,
		(SELECT COUNT(*) ${where.sql}) AS total FROM changes`)
		.bind(...where.values)
		.first<{ head: number; total: number }>();
	if (!row) throw new ApiError("unavailable", "trash snapshot unavailable");
	return { kind, filter, ...row } satisfies TrashCursor;
}

export async function trashCount(env: Env, filters: Filters, head: number): Promise<number> {
	const where = selection(filters, head);
	const row = await env.DB.prepare(`SELECT COUNT(*) AS total ${where.sql}`)
		.bind(...where.values)
		.first<{ total: number }>();
	if (!row) throw new ApiError("unavailable", "trash count unavailable");
	return row.total;
}

export async function trashIds(env: Env, filters: Filters, cursor: TrashCursor): Promise<string[]> {
	const where = selection(filters, cursor.head, cursor.after);
	const { results } = await env.DB.prepare(`SELECT m.id ${where.sql} ORDER BY m.id DESC LIMIT ?`)
		.bind(...where.values, EMPTY_BATCH_SIZE)
		.all<{ id: string }>();
	return results.map((row) => row.id);
}

export async function listTrash(env: Env, query: Record<string, string[]>) {
	const filters = readQuery(querySchema, query);
	const cursor = await trashSnapshot(env, filters, "trash-list", filters.cursor);
	const where = selection(filters, cursor.head, cursor.after);
	const { results } =
		await env.DB.prepare(`SELECT m.id, m.space_id, s.slug AS space_slug, m.title, m.type, m.importance,
		m.source_key_id, m.updated_by_key_id, m.event_time, m.version, m.content_hash,
		m.created_at, m.updated_at, m.deleted_at, m.deleted_by,
		(SELECT json_group_array(name) FROM (SELECT t.name FROM memory_tags mt JOIN tags t ON t.id=mt.tag_id
		WHERE mt.memory_id=m.id ORDER BY mt.position, mt.tag_id)) AS tags_json
		${where.sql} ORDER BY m.id DESC LIMIT ?`)
			.bind(...where.values, filters.limit + 1)
			.all<Omit<MemoryRecord, "body"> & { tags_json: string }>();
	const rows = results.slice(0, filters.limit);
	const last = rows.at(-1);
	return {
		items: rows.map((row) => publicMemory(row, JSON.parse(row.tags_json) as string[])),
		total: await trashCount(env, filters, cursor.head),
		next_cursor:
			results.length > filters.limit && last
				? await encodeCursor(cursorSecretFromEnv(env), { ...cursor, after: last.id })
				: null,
	};
}
