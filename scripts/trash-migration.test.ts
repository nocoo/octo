import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("trash audit migration after deployed word search", () => {
	it("keeps migration numbers unique and appends trash audit as 0009", () => {
		const files = readdirSync("migrations").filter((file) => file.endsWith(".sql"));
		expect(new Set(files.map((file) => file.slice(0, 4))).size).toBe(files.length);
		expect(files).toContain("0009_trash_audit.sql");
		expect(files).not.toContain("0008_trash_audit.sql");
	});

	it("adds audit counts without changing existing word data or vector retry state", () => {
		const db = new DatabaseSync(":memory:");
		try {
			for (const file of readdirSync("migrations")
				.filter((file) => file.endsWith(".sql") && file.slice(0, 4) <= "0008")
				.sort()) {
				db.exec(readFileSync(`migrations/${file}`, "utf8"));
			}
			expect(
				db.prepare("SELECT name FROM sqlite_master WHERE name = 'audit_bulk_counts'").get(),
			).toBeUndefined();
			db.exec(
				"INSERT INTO memories_words_fts(rowid, title, body, tags) VALUES (7, 'kept', 'word data', 'tag')",
			);
			db.exec("UPDATE search_backfill_state SET memory_cursor = 'kept', complete = 1 WHERE id = 1");
			const retrySchema = db.prepare("PRAGMA table_info(vector_sync_jobs)").all();
			db.exec(readFileSync("migrations/0009_trash_audit.sql", "utf8"));
			expect(db.prepare("SELECT rowid, title, body, tags FROM memories_words_fts").all()).toEqual([
				{ rowid: 7, title: "kept", body: "word data", tags: "tag" },
			]);
			expect(
				db.prepare("SELECT memory_cursor, complete FROM search_backfill_state WHERE id = 1").get(),
			).toEqual({ memory_cursor: "kept", complete: 1 });
			expect(db.prepare("PRAGMA table_info(vector_sync_jobs)").all()).toEqual(retrySchema);
			expect(
				db
					.prepare("PRAGMA table_info(audit_bulk_counts)")
					.all()
					.map((row) => row.name),
			).toEqual(["audit_id", "requested_count", "succeeded_count", "failed_count"]);
		} finally {
			db.close();
		}
	});
});
