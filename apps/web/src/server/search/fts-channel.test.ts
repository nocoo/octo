import { describe, expect, it } from "vitest";
import { runFtsChannel } from "./fts-channel";

function database(
	respond: (sql: string, binds: unknown[]) => Array<{ id: string; score: number }>,
) {
	return {
		prepare: (sql: string) => ({
			bind: (...binds: unknown[]) => ({
				all: async () => ({ results: respond(sql, binds) }),
				first: async () => null,
			}),
		}),
	} as unknown as D1Database;
}

describe("indexed FTS channel", () => {
	it("uses word MATCH for short terms without scanning or recency ordering", async () => {
		const db = database((sql, binds) => {
			expect(sql).toContain("memories_words_fts MATCH");
			expect(sql).not.toMatch(/LIKE|instr|updated_at DESC/);
			expect(binds[0]).toBe('"部署"');
			return [{ id: "old", score: -2 }];
		});
		expect(await runFtsChannel(db, "部署", ["s1"], undefined, 5)).toEqual({
			hits: [{ id: "old", bm25: -2 }],
			partial: false,
		});
	});
	it("tries AND then ranked OR only when AND has no authorized matches", async () => {
		const matches: unknown[] = [];
		const db = database((sql, binds) => {
			expect(sql).toContain("m.space_id");
			expect(sql).toContain("m.deleted_at IS NULL");
			matches.push(binds[0]);
			return String(binds[0]).includes(" OR ") ? [{ id: "m1", score: -1 }] : [];
		});
		expect((await runFtsChannel(db, "密钥 轮换", ["s1"], undefined, 5)).hits).toHaveLength(1);
		expect(matches).toEqual([
			'"密钥" AND "轮换"',
			'("密" AND "钥") AND ("轮" AND "换")',
			'"密钥" OR "轮换"',
		]);
	});
	it("keeps trigram substring fallback when every term supports it", async () => {
		const db = database((sql) =>
			sql.includes("FROM memories_fts\n") ? [{ id: "substring", score: -1 }] : [],
		);
		expect((await runFtsChannel(db, "oudf", ["s1"], undefined, 5)).hits[0]?.id).toBe("substring");
	});
	it.each(["   ", "absent", "missing 部署"])(
		"returns complete empty results for %s",
		async (query) => {
			expect(
				await runFtsChannel(
					database(() => []),
					query,
					["s1"],
					undefined,
					5,
				),
			).toEqual({ hits: [], partial: false });
		},
	);
	it("returns empty for inaccessible spaces and unresolved tags", async () => {
		const db = database(() => []);
		expect((await runFtsChannel(db, "cloudflare", [], undefined, 5)).hits).toEqual([]);
		expect(
			(await runFtsChannel(db, "cloudflare", ["s1"], { tags_all: ["ghost"] }, 5)).hits,
		).toEqual([]);
	});
});
