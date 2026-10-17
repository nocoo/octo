import { normalizeTagName } from "./tags";

export async function resolveCanonicalTagIds(db: D1Database, names: string[]): Promise<string[]> {
	const out: string[] = [];
	for (const raw of names) {
		const name = normalizeTagName(raw);
		const row = await db
			.prepare("SELECT id, merged_into FROM tags WHERE name = ?")
			.bind(name)
			.first<{ id: string; merged_into: string | null }>();
		if (!row) {
			continue;
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
		out.push(current.id);
	}
	return [...new Set(out)];
}
