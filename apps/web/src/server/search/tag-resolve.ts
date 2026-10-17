import { normalizeTag } from "../repo/tags";

async function resolveOneCanonicalTagId(db: D1Database, raw: string): Promise<string | null> {
	const name = normalizeTag(raw);
	const row = await db
		.prepare("SELECT id, merged_into FROM tags WHERE name = ?")
		.bind(name)
		.first<{ id: string; merged_into: string | null }>();
	if (!row) {
		return null;
	}
	let current = row;
	while (current.merged_into) {
		const next = await db
			.prepare("SELECT id, merged_into FROM tags WHERE id = ?")
			.bind(current.merged_into)
			.first<{ id: string; merged_into: string | null }>();
		if (!next) {
			break;
		}
		current = next;
	}
	return current.id;
}

export async function resolveCanonicalTagIds(db: D1Database, names: string[]): Promise<string[]> {
	const out: string[] = [];
	for (const raw of names) {
		const id = await resolveOneCanonicalTagId(db, raw);
		if (id) {
			out.push(id);
		}
	}
	return [...new Set(out)];
}

/** Every name must resolve; returns null if any tag is unknown. */
export async function resolveRequiredTagIds(
	db: D1Database,
	names: string[],
): Promise<string[] | null> {
	if (names.length === 0) {
		return [];
	}
	const out: string[] = [];
	for (const raw of names) {
		const id = await resolveOneCanonicalTagId(db, raw);
		if (!id) {
			return null;
		}
		out.push(id);
	}
	return [...new Set(out)];
}
