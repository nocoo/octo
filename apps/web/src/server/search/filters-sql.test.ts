import { describe, expect, it } from "vitest";
import {
	buildMemoryFilterSql,
	tagsAllExistsSql,
	tagsAnyExistsSql,
	timeColumn,
} from "./filters-sql";

describe("buildMemoryFilterSql", () => {
	it("requires visible spaces", () => {
		expect(buildMemoryFilterSql(undefined, []).clauses).toContain("1 = 0");
	});

	it("adds type and importance filters", () => {
		const { clauses, binds } = buildMemoryFilterSql(
			{ types: ["note"], importance: { min: 0.2, max: 0.9 } },
			["s1"],
		);
		expect(clauses.join(" ")).toMatch(/m.type IN/);
		expect(clauses.join(" ")).toMatch(/m.importance >=/);
		expect(binds).toEqual(['["s1"]', '["note"]', 0.2, 0.9]);
	});

	it("maps time filters to columns", () => {
		const { clauses, binds } = buildMemoryFilterSql(
			{ time: { field: "updated", from: "2026-01-01T00:00:00Z" } },
			["s1"],
		);
		expect(clauses.some((c) => c.startsWith("m.updated_at >="))).toBe(true);
		expect(binds[1]).toBe(Date.parse("2026-01-01T00:00:00Z"));
	});
});

describe("tag exists helpers", () => {
	it("builds tags_all and tags_any", () => {
		expect(tagsAllExistsSql(["t1", "t2"]).sql.split("EXISTS").length).toBe(3);
		expect(tagsAnyExistsSql(["t1"]).sql).toContain("json_each(?)");
	});
});

describe("timeColumn", () => {
	it("selects columns", () => {
		expect(timeColumn("created")).toBe("m.created_at");
		expect(timeColumn("event")).toBe("m.event_time");
	});

	it("adds source and time.to filters", () => {
		const { clauses, binds } = buildMemoryFilterSql(
			{
				sources: ["k1"],
				time: { field: "event", to: "2026-02-01T00:00:00Z" },
			},
			["s1"],
		);
		expect(clauses.join(" ")).toMatch(/source_key_id/);
		expect(clauses.join(" ")).toMatch(/event_time <=/);
		expect(binds).toContain('["k1"]');
	});
});
