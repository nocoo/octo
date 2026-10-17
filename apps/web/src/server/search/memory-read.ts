import { d1Results } from "../lib/d1";
import { msToIso } from "./time";

export type MemoryRow = {
	id: string;
	space_id: string;
	space_slug: string;
	title: string;
	body: string;
	type: string;
	importance: number;
	created_at: number;
	updated_at: number;
	event_time: number | null;
};

export async function loadSpaceSlugMap(db: D1Database): Promise<Map<string, string>> {
	const rows = await db.prepare("SELECT id, slug FROM spaces").all<{ id: string; slug: string }>();
	const map = new Map<string, string>();
	for (const row of d1Results(rows)) {
		map.set(row.id, row.slug);
	}
	return map;
}

export async function loadMemoriesByIds(
	db: D1Database,
	ids: string[],
): Promise<Map<string, MemoryRow>> {
	if (ids.length === 0) {
		return new Map();
	}
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await db
		.prepare(
			`SELECT m.id, m.space_id, s.slug AS space_slug, m.title, m.body, m.type, m.importance,
        m.created_at, m.updated_at, m.event_time
       FROM memories m
       JOIN spaces s ON s.id = m.space_id
       WHERE m.id IN (${placeholders}) AND m.deleted_at IS NULL`,
		)
		.bind(...ids)
		.all<MemoryRow>();
	const map = new Map<string, MemoryRow>();
	for (const row of d1Results(rows)) {
		map.set(row.id, row);
	}
	return map;
}

export async function loadTagsForMemories(
	db: D1Database,
	memoryIds: string[],
): Promise<Map<string, string[]>> {
	if (memoryIds.length === 0) {
		return new Map();
	}
	const placeholders = memoryIds.map(() => "?").join(", ");
	const rows = await db
		.prepare(
			`SELECT mt.memory_id, t.name
       FROM memory_tags mt
       JOIN tags t ON t.id = mt.tag_id
       WHERE mt.memory_id IN (${placeholders})`,
		)
		.bind(...memoryIds)
		.all<{ memory_id: string; name: string }>();
	const map = new Map<string, string[]>();
	for (const row of d1Results(rows)) {
		const list = map.get(row.memory_id) ?? [];
		list.push(row.name);
		map.set(row.memory_id, list);
	}
	return map;
}

export function memoryToApi(row: MemoryRow, tags: string[]) {
	return {
		id: row.id,
		space: row.space_slug,
		title: row.title,
		body: row.body,
		type: row.type,
		tags,
		importance: row.importance,
		created_at: msToIso(row.created_at),
		updated_at: msToIso(row.updated_at),
		event_time: row.event_time === null ? null : msToIso(row.event_time),
	};
}
