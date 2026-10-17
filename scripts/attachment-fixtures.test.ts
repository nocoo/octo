import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { seedAttachmentKey } from "./attachment-fixtures";
import { migrationSqlForNode } from "./sqlite-test";

describe("attachment key fixtures", () => {
	it("awaits asynchronous fixture insertion before returning credentials", async () => {
		let inserted = false;
		await seedAttachmentKey(async () => {
			await new Promise<void>((resolve) => setImmediate(resolve));
			inserted = true;
			return "";
		});
		expect(inserted).toBe(true);
	});

	it("seeds distinct keys together for the permission matrix", async () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(migrationSqlForNode(readFileSync("migrations/0001_core.sql", "utf8")));
			const d1 = (args: string[]) => {
				db.exec(args[1] ?? "");
				return "";
			};
			const keys = [
				await seedAttachmentKey(d1),
				await seedAttachmentKey(d1, { scope: "spaces" }),
				await seedAttachmentKey(d1, { ops: "w" }),
				await seedAttachmentKey(d1, { ownOnly: true }),
			];
			expect(new Set(keys.map((key) => key.keyId)).size).toBe(4);
			for (const key of keys) {
				expect(key.header).toMatch(/^Bearer octo_/);
				expect(db.prepare("SELECT name FROM api_keys WHERE id = ?").get(key.keyId)).toMatchObject({
					name: `e2e-att-${key.keyId}`,
				});
			}
			expect(
				db.prepare("SELECT ops, scope, own_entries_only FROM api_keys ORDER BY rowid").all(),
			).toEqual([
				{ ops: "r,w,u,d", scope: "all", own_entries_only: 0 },
				{ ops: "r,w,u,d", scope: "spaces", own_entries_only: 0 },
				{ ops: "w", scope: "all", own_entries_only: 0 },
				{ ops: "r,w,u,d", scope: "all", own_entries_only: 1 },
			]);
			db.exec("DELETE FROM api_keys WHERE name LIKE 'e2e-att%'");
			expect(db.prepare("SELECT COUNT(*) AS n FROM api_keys").get()).toMatchObject({ n: 0 });
		} finally {
			db.close();
		}
	});
});
