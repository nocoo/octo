import type { AuthzContext } from "./authz";
import { canReadSpace } from "./authz";
import { loadMemoriesByIds, loadTagsForMemories, memoryToApi } from "./memory-read";

export async function batchGetMemories(db: D1Database, authz: AuthzContext, ids: string[]) {
	const unique = [...new Set(ids)];
	const rows = await loadMemoriesByIds(db, unique);
	const tags = await loadTagsForMemories(db, [...rows.keys()]);
	const items = [];
	const found = new Set<string>();
	for (const id of unique) {
		const row = rows.get(id);
		if (!row || !canReadSpace(authz, row.space_id)) {
			continue;
		}
		found.add(id);
		items.push(memoryToApi(row, tags.get(id) ?? []));
	}
	const missing = unique.filter((id) => !found.has(id));
	return { items, missing };
}
