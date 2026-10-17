import { describe, expect, it } from "vitest";
import { sqlInClause } from "./sql-in";

describe("sqlInClause", () => {
	it("returns false for empty lists", () => {
		expect(sqlInClause("m.space_id", [])).toEqual({ sql: "1 = 0", binds: [] });
	});

	it.each([1, 40, 41, 100, 200])("uses one JSON bind for %i values", (size) => {
		const values = Array.from({ length: size }, (_, i) => `k${i}`);
		expect(sqlInClause("m.source_key_id", values)).toEqual({
			sql: "m.source_key_id IN (SELECT value FROM json_each(?))",
			binds: [JSON.stringify(values)],
		});
	});
});
