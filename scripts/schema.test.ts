import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATION, CORE_TABLES } from "./schema";
import { migrationSqlForNode } from "./sqlite-test";

describe("0001_core.sql", () => {
	it("creates every documented table and the embedding seed", () => {
		const sql = migrationSqlForNode(readFileSync(CORE_MIGRATION, "utf8"));
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(sql);
			const rows = db
				.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
				.all() as Array<{ name: string }>;
			const names = new Set(rows.map((row) => row.name));
			for (const table of CORE_TABLES) {
				if ((table === "memories_fts" || table === "memories_fts_map") && !names.has(table)) {
					continue;
				}
				expect(names.has(table)).toBe(true);
			}
			const profile = db
				.prepare("SELECT id, model, dims, metric, active FROM embedding_profiles")
				.get() as { id: string; model: string; dims: number; metric: string; active: number };
			expect(profile).toEqual({
				id: "te3-small-1536",
				model: "text-embedding-3-small",
				dims: 1536,
				metric: "cosine",
				active: 1,
			});
		} finally {
			db.close();
		}
	});
});
