import { describe, expect, it } from "vitest";
import { vectorFilterSql } from "./filter-sql";

describe("vectorFilterSql", () => {
	it("maps scalar equality without allowing SQL identifiers from input", () => {
		expect(vectorFilterSql({ space: "kb" })).toEqual({ clauses: ["s.slug = ?"], binds: ["kb"] });
		expect(() => vectorFilterSql({ arbitrary: "kb" })).toThrow("field");
		expect(() => vectorFilterSql({ space: { $ne: "kb" } })).toThrow("operator");
	});
});
