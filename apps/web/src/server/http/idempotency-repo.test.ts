import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import {
	commitIdempotencyOutcome,
	findIdempotencyRecord,
	purgeIdempotencyOlderThan,
	readIdempotencyResponse,
} from "./idempotency-repo";

describe("idempotency outcome storage", () => {
	it.each(["bad", "0", "-1", "1.5", "9007199254740992"])(
		"rejects corrupt chunk count %s",
		async (count) => {
			const { db, sqlite } = sqliteD1();
			await commitIdempotencyOutcome(db, "k", "i", "h", 200, "{}", []);
			sqlite.prepare("UPDATE idempotency_records SET response_json = ?").run(count);
			await expect(readIdempotencyResponse(db, "k", "i", "h")).rejects.toMatchObject({
				code: "unavailable",
			});
			sqlite.close();
		},
	);
	it("purges completed records and cascades chunks but preserves uncertain legacy pending rows", async () => {
		const { db, sqlite } = sqliteD1();
		await commitIdempotencyOutcome(db, "k", "complete", "h", 200, "{}", []);
		sqlite.exec(
			"UPDATE idempotency_records SET created_at = 1; INSERT INTO idempotency_records VALUES ('k', 'pending', 'h', 0, '', 1)",
		);
		expect(await purgeIdempotencyOlderThan(db, 2)).toBe(1);
		expect(sqlite.prepare("SELECT * FROM idempotency_response_chunks").all()).toEqual([]);
		expect(await findIdempotencyRecord(db, "k", "pending")).toMatchObject({ status: 0 });
		await expect(readIdempotencyResponse(db, "k", "pending", "h")).rejects.toMatchObject({
			code: "unavailable",
		});
		await expect(readIdempotencyResponse(db, "k", "pending", "different")).rejects.toMatchObject({
			code: "idempotency_conflict",
		});
		sqlite.close();
	});
	it("rejects incomplete chunks instead of replaying a partial body", async () => {
		const { db, sqlite } = sqliteD1();
		await commitIdempotencyOutcome(db, "k", "i", "h", 200, "x".repeat(120_001), []);
		sqlite.exec("DELETE FROM idempotency_response_chunks WHERE chunk_index = 1");
		await expect(readIdempotencyResponse(db, "k", "i", "h")).rejects.toMatchObject({
			code: "unavailable",
		});
		sqlite.exec("UPDATE idempotency_records SET response_json = '2'");
		await expect(readIdempotencyResponse(db, "k", "i", "h")).rejects.toMatchObject({
			code: "unavailable",
		});
		sqlite.close();
	});
	it("returns zero when a driver omits the deletion count", async () => {
		const db = {
			prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }),
		} as unknown as D1Database;
		expect(await purgeIdempotencyOlderThan(db, 1)).toBe(0);
	});
});
