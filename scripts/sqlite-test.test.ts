import { describe, expect, it } from "vitest";
import {
	migrationSqlForNode,
	migrationSqlForNodeWithSupport,
	sqliteSupportsFts5,
} from "./sqlite-test";

describe("sqlite-test", () => {
	it("strips fts when unsupported", () => {
		const sql = "CREATE VIRTUAL TABLE memories_fts USING fts5(x);";
		expect(migrationSqlForNodeWithSupport(sql, false)).toContain("skipped");
		expect(migrationSqlForNodeWithSupport(sql, true)).toBe(sql);
		expect(typeof sqliteSupportsFts5()).toBe("boolean");
		expect(migrationSqlForNode(sql)).toBeTruthy();
	});
});
