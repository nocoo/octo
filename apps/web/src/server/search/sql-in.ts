export function sqlInClause(
	column: string,
	values: readonly string[],
): { sql: string; binds: string[] } {
	if (values.length === 0) return { sql: "1 = 0", binds: [] };
	return {
		sql: `${column} IN (SELECT value FROM json_each(?))`,
		binds: [JSON.stringify(values)],
	};
}
