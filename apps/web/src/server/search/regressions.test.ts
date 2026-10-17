import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrationSqlForNode } from "../../../../../scripts/sqlite-test";
import { batchGetMemories } from "./batch-get";
import { searchMemories } from "./service";

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

function fixture(beforeQuery: (sql: string) => void = () => {}) {
	const sqlite = new DatabaseSync(":memory:");
	databases.push(sqlite);
	sqlite.exec(migrationSqlForNode(readFileSync("migrations/0001_core.sql", "utf8")));
	sqlite.exec(`INSERT INTO spaces VALUES ('s1','visible','Visible','',NULL,1,1), ('s2','hidden','Hidden','',NULL,1,1);
		INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
		VALUES ('m1','s1','cloudflare 部署','public','note','k','hash',1,1);
		INSERT INTO memories_fts(rowid,title,body,tags) VALUES (1,'cloudflare 部署','public','');
		INSERT INTO memories_fts_map VALUES ('m1',1);`);
	const db = {
		prepare(sql: string) {
			const execute = (binds: SQLInputValue[]) => {
				expect(binds.length).toBeLessThanOrEqual(100);
				beforeQuery(sql);
				return sqlite.prepare(sql).all(...binds);
			};
			return {
				all: async () => ({ results: execute([]) }),
				bind: (...binds: SQLInputValue[]) => ({
					all: async () => ({ results: execute(binds) }),
					first: async () => execute(binds)[0] ?? null,
				}),
			};
		},
	} as unknown as D1Database;
	return { db, sqlite };
}

const authz = { keyId: "k", visibleSpaceIds: ["s1"] };

describe("same-statement memory visibility", () => {
	it("does not return content moved to a hidden space after candidate validation", async () => {
		const { db, sqlite } = fixture((sql) => {
			if (sql.includes("m.body, m.type")) {
				sqlite.exec("UPDATE memories SET space_id='s2', body='secret' WHERE id='m1'");
			}
		});
		const result = await searchMemories(authz, { query: "cloudflare", mode: "fts" }, { db });
		expect(result.items).toEqual([]);
	});

	it("rechecks filters when reading content, not only candidate ids", async () => {
		const { db, sqlite } = fixture((sql) => {
			if (sql.includes("m.body, m.type")) {
				sqlite.exec("UPDATE memories SET type='secret' WHERE id='m1'");
			}
		});
		const result = await searchMemories(
			authz,
			{ query: "cloudflare", filters: { types: ["note"] } },
			{ db },
		);
		expect(result.items).toEqual([]);
	});

	it.each(["all", "any"] as const)("checks tags_%s in the final content read", async (kind) => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO tags VALUES ('t1','infra','infra',NULL,1,1); INSERT INTO memory_tags VALUES ('m1','t1')",
		);
		const filters = kind === "all" ? { tags_all: ["infra"] } : { tags_any: ["infra"] };
		expect(
			(await searchMemories(authz, { query: "cloudflare", filters }, { db })).items,
		).toHaveLength(1);
		if (kind === "all") {
			filters.tags_all = ["infra", "unknown"];
		} else {
			filters.tags_any = ["unknown"];
		}
		expect((await searchMemories(authz, { query: "cloudflare", filters }, { db })).items).toEqual(
			[],
		);
	});

	it("returns all ids as missing for empty visible spaces", async () => {
		const { db } = fixture();
		expect(await batchGetMemories(db, { keyId: "k", visibleSpaceIds: [] }, ["m1"])).toEqual({
			items: [],
			missing: ["m1"],
		});
	});
});
