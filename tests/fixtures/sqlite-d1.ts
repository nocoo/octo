import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrationSqlForNode } from "../../scripts/sqlite-test";
import { MEMORY_FIXTURE_SQL } from "./memories";

export function sqliteD1() {
	const sqlite = new DatabaseSync(":memory:");
	for (const file of readdirSync("migrations")
		.filter((f) => f.endsWith(".sql"))
		.sort()) {
		sqlite.exec(migrationSqlForNode(readFileSync(`migrations/${file}`, "utf8")));
	}
	sqlite.exec(MEMORY_FIXTURE_SQL);
	type Bound = { sql: string; params: (string | number | null)[] };
	const result = (bound: Bound) => {
		const statement = sqlite.prepare(bound.sql);
		statement.setReadBigInts(true);
		const info = statement.run(...bound.params);
		return { success: true, meta: { changes: Number(info.changes) }, results: [] };
	};
	const prepare = (sql: string, params: Bound["params"] = []) => ({
		sql,
		params,
		bind: (...values: Bound["params"]) => prepare(sql, values),
		run: async () => result({ sql, params }),
		first: async () => sqlite.prepare(sql).get(...params) ?? null,
		all: async () => ({ success: true, results: sqlite.prepare(sql).all(...params) }),
	});
	const db = {
		prepare,
		exec: async (sql: string) => {
			for (const line of sql.split("\n").filter((line) => line.trim())) sqlite.exec(line);
			return { count: 1, duration: 0 };
		},
		batch: async (statements: Bound[]) => {
			sqlite.exec("BEGIN");
			try {
				const results = statements.map(result);
				sqlite.exec("COMMIT");
				return results;
			} catch (err) {
				sqlite.exec("ROLLBACK");
				throw err;
			}
		},
	} as unknown as D1Database;
	return { db, sqlite };
}
