/** D1/SQLite bind limit is 100 variables; prefer JSON sets for large IN lists. */
export const SQL_IN_CHUNK_SIZE = 40;

export function sqlInClause(
	column: string,
	values: readonly string[],
): { sql: string; binds: unknown[] } {
	if (values.length === 0) {
		return { sql: "1 = 0", binds: [] };
	}
	if (values.length <= SQL_IN_CHUNK_SIZE) {
		return {
			sql: `${column} IN (${values.map(() => "?").join(", ")})`,
			binds: [...values],
		};
	}
	return {
		sql: `${column} IN (SELECT value FROM json_each(?))`,
		binds: [JSON.stringify(values)],
	};
}

export function chunkIds(ids: string[], size = SQL_IN_CHUNK_SIZE): string[][] {
	const chunks: string[][] = [];
	for (let i = 0; i < ids.length; i += size) {
		chunks.push(ids.slice(i, i + size));
	}
	return chunks;
}
