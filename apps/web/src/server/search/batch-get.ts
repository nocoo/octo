import type { AuthzContext } from "./authz";
import { canReadSpace } from "./authz";
import { buildMemoryFilterSql } from "./filters-sql";
import { loadMemoriesByIds, memoryToApi } from "./memory-read";

export async function batchGetMemories(db: D1Database, authz: AuthzContext, ids: string[]) {
	const unique = [...new Set(ids)];
	const filter =
		authz.visibleSpaceIds === "all"
			? { clauses: ["m.deleted_at IS NULL"], binds: [] }
			: buildMemoryFilterSql(undefined, authz.visibleSpaceIds);
	const rows = await loadMemoriesByIds(db, unique, filter);
	const items = [];
	const found = new Set<string>();
	for (const id of unique) {
		const row = rows.get(id);
		if (!row || !canReadSpace(authz, row.space_id)) {
			continue;
		}
		found.add(id);
		items.push(memoryToApi(row));
	}
	const missing = unique.filter((id) => !found.has(id));
	return { items, missing };
}
