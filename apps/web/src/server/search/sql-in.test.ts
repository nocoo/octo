import { describe, expect, it } from "vitest";
import { chunkIds, sqlInClause } from "./sql-in";

describe("sqlInClause", () => {
	it("returns false for empty lists", () => {
		expect(sqlInClause("m.space_id", [])).toEqual({ sql: "1 = 0", binds: [] });
	});

	it("uses placeholders for small lists", () => {
		expect(sqlInClause("m.space_id", ["a", "b"])).toEqual({
			sql: "m.space_id IN (?, ?)",
			binds: ["a", "b"],
		});
	});

	it("chunks id lists", () => {
		expect(chunkIds(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
	});

	it("uses json_each for large lists", () => {
		const values = Array.from({ length: 50 }, (_, i) => `k${i}`);
		const result = sqlInClause("m.source_key_id", values);
		expect(result.sql).toContain("json_each");
		expect(result.binds).toHaveLength(1);
	});
});
