import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrationSqlForNode } from "../../../../../scripts/sqlite-test";
import { AttachmentRepo } from "./repo";

function d1FromDb(db: DatabaseSync): D1Database {
	return {
		prepare: (sql: string) => ({
			bind: (...params: Array<string | number | null>) => ({
				first: async () => db.prepare(sql).get(...params) ?? null,
				all: async () => ({ results: db.prepare(sql).all(...params) }),
				run: async () => {
					const info = db.prepare(sql).run(...params);
					return { meta: { changes: info.changes } };
				},
			}),
			first: async () => db.prepare(sql).get() ?? null,
			all: async () => ({ results: db.prepare(sql).all() }),
			run: async () => {
				const info = db.prepare(sql).run();
				return { meta: { changes: info.changes } };
			},
		}),
		batch: async (stmts: Array<{ run: () => Promise<{ meta: { changes?: number } }> }>) => {
			const out: Array<{ meta: { changes?: number } }> = [];
			db.exec("BEGIN");
			try {
				for (const stmt of stmts) {
					out.push(await stmt.run());
				}
				db.exec("COMMIT");
				return out;
			} catch (err) {
				db.exec("ROLLBACK");
				throw err;
			}
		},
	} as unknown as D1Database;
}

describe("AttachmentRepo integration", () => {
	it("inserts, lists, and soft-deletes", async () => {
		const sql = readFileSync(join(process.cwd(), "migrations/0001_core.sql"), "utf8");
		const db = new DatabaseSync(":memory:");
		db.exec(migrationSqlForNode(sql));
		const now = Date.now();
		db.prepare(
			"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('s1', 's', 'S', '', 'k1', ?, ?)",
		).run(now, now);
		db.prepare(
			"INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('m1', 's1', 't', 'b', 'note', 0.5, 'k1', 1, 'h', ?, ?)",
		).run(now, now);
		const d1 = d1FromDb(db);
		const repo = new AttachmentRepo({ db: d1 });
		const row = {
			id: "a1",
			memory_id: "m1",
			r2_key: "att/m1/a1",
			filename: "f.png",
			content_type: "image/png",
			size_bytes: 2,
			sha256: "sha",
			created_by: "key:k1",
			created_at: now,
			deleted_at: null,
		};
		await d1.batch(repo.insertStatements(row, "s1", "key:k1", now));
		expect(await repo.listForMemory("m1")).toHaveLength(1);
		expect(await repo.getAttachment("a1")).toMatchObject({ id: "a1" });
		db.exec(`CREATE TRIGGER reject_trash BEFORE INSERT ON changes
			WHEN NEW.op = 'trashed' BEGIN SELECT RAISE(ABORT, 'event failure'); END`);
		await expect(
			d1.batch(repo.softDeleteStatements("a1", "s1", "key:k1", now + 1)),
		).rejects.toThrow("event failure");
		expect(await repo.getAttachment("a1")).toMatchObject({ deleted_at: null });
		expect(db.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 1 });
		db.exec("DROP TRIGGER reject_trash");
		expect(
			(await d1.batch(repo.softDeleteStatements("a1", "s1", "key:k1", now + 1)))[1]?.meta.changes,
		).toBe(1);
		expect(await repo.listForMemory("m1")).toHaveLength(0);
		const changes = db
			.prepare("SELECT op FROM changes WHERE entity = 'attachment' AND entity_id = 'a1'")
			.all() as Array<{ op: string }>;
		expect(changes.map((c) => c.op).sort()).toEqual(["created", "trashed"]);
		await expect(
			d1.batch(repo.softDeleteStatements("a1", "s1", "key:k1", now + 1)),
		).rejects.toThrow("NOT NULL constraint failed: attachments.filename");
		await expect(
			d1.batch(repo.softDeleteStatements("a1", "s1", "key:k1", now + 2)),
		).rejects.toThrow("NOT NULL constraint failed: attachments.filename");
		const changesAfter = db
			.prepare("SELECT COUNT(*) AS n FROM changes WHERE entity = 'attachment' AND entity_id = 'a1'")
			.get() as { n: number };
		expect(changesAfter.n).toBe(2);
		db.close();
	});
});
