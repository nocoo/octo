import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrationSqlForNode } from "../../../../../scripts/sqlite-test";
import { batchGetMemories } from "./batch-get";
import { runFtsChannel } from "./fts-channel";
import { searchMemories } from "./service";
import { FTS_SHORT_SCAN_LIMIT } from "./tokenizer";

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

function fixture(
	beforeQuery: (sql: string) => void = () => {},
	afterQuery: (sql: string) => void = () => {},
) {
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
				const rows = sqlite.prepare(sql).all(...binds);
				afterQuery(sql);
				return rows;
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

function addMemory(sqlite: DatabaseSync, id: string, body: string, updated: number) {
	sqlite
		.prepare(`INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
		VALUES (?,'s1','cloudflare',?,'note','k','hash',1,?)`)
		.run(id, body, updated);
	sqlite.prepare("INSERT INTO memories_fts(title,body,tags) VALUES ('cloudflare',?,'')").run(body);
	sqlite.prepare("INSERT INTO memories_fts_map VALUES (?,last_insert_rowid())").run(id);
}

const authz = { keyId: "k", visibleSpaceIds: ["s1"] };

describe("bounded search SQL", () => {
	it("caps rows before LIKE even when the only match lies beyond the cap", async () => {
		const { db, sqlite } = fixture();
		sqlite.exec("UPDATE memories SET body='部署', updated_at=0");
		for (let i = 0; i < FTS_SHORT_SCAN_LIMIT; i++) addMemory(sqlite, `n${i}`, "unrelated", i + 1);
		const result = await runFtsChannel(db, "部署", ["s1"], undefined, 100);
		expect(result).toEqual({ hits: [], partial: true });
	});

	it.each([40, 41, 100])(
		"keeps maximal filters within 100 binds at %i sources/spaces",
		async (size) => {
			const { db, sqlite } = fixture();
			const names = Array.from({ length: 50 }, (_, i) => `tag${i}`);
			for (const name of names) {
				sqlite.prepare("INSERT INTO tags VALUES (?,?,?,NULL,1,1)").run(name, name, name);
				sqlite.prepare("INSERT INTO memory_tags VALUES ('m1',?)").run(name);
			}
			const result = await runFtsChannel(
				db,
				"cloudflare 部署",
				["s1", ...Array.from({ length: size - 1 }, (_, i) => `s${i + 2}`)],
				{
					sources: ["k", ...Array.from({ length: size - 1 }, (_, i) => `k${i}`)],
					types: ["note", ...Array.from({ length: 49 }, (_, i) => `type${i}`)],
					tags_all: names,
					tags_any: names,
					importance: { min: 0, max: 1 },
					time: { field: "updated", from: "1970-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" },
				},
				100,
			);
			expect(result.hits.map((hit) => hit.id)).toEqual(["m1"]);
		},
	);

	it("resolves maximal tag filters once rather than once per vector hit", async () => {
		let queryCount = 0;
		const { db, sqlite } = fixture(() => {
			queryCount++;
		});
		const names = Array.from({ length: 50 }, (_, i) => `t${i}`);
		for (const name of names)
			sqlite.prepare("INSERT INTO tags VALUES (?,?,?,NULL,1,1)").run(name, name, name);
		const ids = Array.from({ length: 100 }, (_, i) => `v${i}`);
		for (const id of ids) {
			addMemory(sqlite, id, "cloudflare", 1);
			for (const name of names)
				sqlite.prepare("INSERT INTO memory_tags VALUES (?,?)").run(id, name);
		}
		const result = await searchMemories(
			authz,
			{
				vector: { profile: "te3-small-1536", values: [1, ...Array<number>(1535).fill(0)] },
				mode: "vector",
				filters: { tags_all: names, tags_any: names },
				limit: 100,
			},
			{ db, vectorStore: { query: async () => ids.map((id, i) => ({ id, score: 1 - i / 100 })) } },
		);
		expect(result.items.map((item) => item.id)).toEqual(ids);
		expect(queryCount).toBeLessThanOrEqual(110);
	});

	it("reads 200 hybrid candidates and tags, plus a 100-id batch, within the bind budget", async () => {
		const { db, sqlite } = fixture();
		sqlite.exec("UPDATE memories SET deleted_at=1 WHERE id='m1'");
		const ids = Array.from({ length: 200 }, (_, i) => `h${String(i).padStart(3, "0")}`);
		for (const [i, id] of ids.entries()) addMemory(sqlite, id, "cloudflare", i + 2);
		const result = await searchMemories(
			authz,
			{
				query: "cloudflare",
				vector: { profile: "te3-small-1536", values: [1, ...Array<number>(1535).fill(0)] },
				mode: "hybrid",
				limit: 200,
			},
			{ db, vectorStore: { query: async () => ids.slice(100).map((id) => ({ id, score: 1 })) } },
		);
		expect(result.items).toHaveLength(200);
		expect(result.channels.fts.candidates).toBe(100);
		expect(result.channels.vector.candidates).toBe(100);
		const batch = await batchGetMemories(db, authz, ids.slice(0, 100));
		expect(batch.items.map((item) => item.id)).toEqual(ids.slice(0, 100));
	});
});

describe("same-statement memory visibility", () => {
	it.each(["search", "batchGet"])(
		"%s never mixes authorized content with newly hidden tags",
		async (operation) => {
			const { db, sqlite } = fixture(undefined, (sql) => {
				if (sql.includes("m.body, m.type"))
					sqlite.exec(`
				UPDATE memories SET space_id='s2' WHERE id='m1';
				DELETE FROM memory_tags WHERE memory_id='m1';
				INSERT INTO memory_tags VALUES ('m1','secret');`);
			});
			sqlite.exec(
				"INSERT INTO tags VALUES ('public','public','Public',NULL,1,1), ('secret','secret','Secret',NULL,1,1); INSERT INTO memory_tags VALUES ('m1','public')",
			);
			const result =
				operation === "search"
					? await searchMemories(authz, { query: "cloudflare" }, { db })
					: await batchGetMemories(db, authz, ["m1"]);
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.tags).toEqual(["public"]);
			expect(sqlite.prepare("SELECT space_id FROM memories WHERE id='m1'").get()?.space_id).toBe(
				"s2",
			);
		},
	);

	it.each(["weighted", "rrf"] as const)(
		"rebuilds ranks and %s fusion from final visible candidates",
		async (method) => {
			const { db, sqlite } = fixture((sql) => {
				if (sql.includes("m.body, m.type"))
					sqlite.exec("UPDATE memories SET space_id='s2' WHERE id='m1'");
			});
			sqlite.exec(
				"DELETE FROM memories_fts WHERE rowid=1; INSERT INTO memories_fts(rowid,title,body,tags) VALUES (1,'cloudflare','cloudflare',''); UPDATE memories SET title='cloudflare',body='cloudflare' WHERE id='m1'",
			);
			addMemory(sqlite, "m2", "cloudflare", 2);
			addMemory(sqlite, "m3", "cloudflare", 3);
			const result = await searchMemories(
				authz,
				{
					query: "cloudflare",
					vector: { profile: "te3-small-1536", values: [1, ...Array<number>(1535).fill(0)] },
					mode: "hybrid",
					fusion: { method, weights: { fts: 1, vector: 1 } },
				},
				{
					db,
					vectorStore: {
						query: async () => [
							{ id: "m1", score: 0.9 },
							{ id: "m2", score: 0.6 },
							{ id: "m3", score: 0.3 },
						],
					},
				},
			);
			expect(result.items.map((item) => item.id)).toEqual(["m2", "m3"]);
			expect(result.channels.fts.candidates).toBe(2);
			expect(result.channels.vector.candidates).toBe(2);
			for (const [i, item] of result.items.entries()) {
				expect(item.scores.vector?.rank).toBe(i + 1);
				expect(item.scores.fts?.rank).toBe(i + 1);
				expect(item.scores.vector?.normalized).toBe(i === 0 ? 1 : 0);
				expect(item.scores.fused).toBeCloseTo(method === "rrf" ? 2 / (61 + i) : 2 - i, 12);
			}
		},
	);

	it.each(["fts", "vector", "hybrid"] as const)(
		"excludes concurrent move/delete/tag changes in %s",
		async (mode) => {
			for (const mutation of [
				"UPDATE memories SET space_id='s2' WHERE id='m1'",
				"UPDATE memories SET deleted_at=2 WHERE id='m1'",
				"DELETE FROM memory_tags WHERE memory_id='m1'",
			]) {
				const { db, sqlite } = fixture((sql) => {
					if (sql.includes("m.body, m.type")) sqlite.exec(mutation);
				});
				sqlite.exec(
					"INSERT INTO tags VALUES ('t1','infra','Infra',NULL,1,1); INSERT INTO memory_tags VALUES ('m1','t1')",
				);
				const result = await searchMemories(
					authz,
					{
						query: "cloudflare",
						vector: { profile: "te3-small-1536", values: [1, ...Array<number>(1535).fill(0)] },
						mode,
						filters: { tags_all: ["infra"] },
					},
					{ db, vectorStore: { query: async () => [{ id: "m1", score: 1 }] } },
				);
				expect(result.items).toEqual([]);
				expect(result.channels.fts.candidates).toBe(0);
				expect(result.channels.vector.candidates).toBe(0);
			}
		},
	);

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
