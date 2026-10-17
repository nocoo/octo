import { describe, expect, it } from "vitest";
import { auditRow, queryFixture } from "./__tests__/queries";
import { rollupUsage } from "./usage";

describe("usage rollup", () => {
	it("aggregates UTC days and keys idempotently from the complete audit history", async () => {
		const { db, sqlite } = queryFixture();
		const now = Date.UTC(2026, 9, 17);
		auditRow(sqlite, { id: "before", at: now - 1, bytes_in: 2, bytes_out: 3 });
		auditRow(sqlite, { id: "ok", at: now, method: "POST", bytes_in: 5, bytes_out: 7 });
		auditRow(sqlite, {
			id: "bad",
			at: now + 1,
			method: "DELETE",
			status: 404,
			bytes_in: 11,
			bytes_out: 13,
		});
		auditRow(sqlite, { id: "search", at: now + 2, method: "POST", route: "/api/v1/search" });
		auditRow(sqlite, {
			id: "batchGet",
			at: now + 3,
			method: "POST",
			route: "/api/v1/memories:batchGet",
		});
		auditRow(sqlite, { id: "other", at: now, actor: "key:BBBBBBBBBBBB", method: "PATCH" });
		auditRow(sqlite, { id: "anonymous", actor: "anonymous", status: 401 });
		auditRow(sqlite, { id: "admin", actor: "admin:person@example.com", method: "DELETE" });
		await rollupUsage(db);
		const first = sqlite.prepare("SELECT * FROM usage_daily ORDER BY day, key_id").all();
		expect(first).toEqual([
			{
				day: "2026-10-16",
				key_id: "AAAAAAAAAAAA",
				calls: 1,
				errors: 0,
				writes: 0,
				bytes_in: 2,
				bytes_out: 3,
			},
			{
				day: "2026-10-17",
				key_id: "AAAAAAAAAAAA",
				calls: 4,
				errors: 1,
				writes: 1,
				bytes_in: 16,
				bytes_out: 20,
			},
			{
				day: "2026-10-17",
				key_id: "BBBBBBBBBBBB",
				calls: 1,
				errors: 0,
				writes: 1,
				bytes_in: 0,
				bytes_out: 0,
			},
		]);
		await rollupUsage(db);
		expect(sqlite.prepare("SELECT * FROM usage_daily ORDER BY day, key_id").all()).toEqual(first);
		auditRow(sqlite, { id: "late", at: now - 2, method: "PUT", bytes_in: 17 });
		await rollupUsage(db);
		expect(
			sqlite.prepare("SELECT * FROM usage_daily WHERE day = '2026-10-16'").get(),
		).toMatchObject({ calls: 2, writes: 1, bytes_in: 19, bytes_out: 3 });
		expect(sqlite.prepare("SELECT count(*) AS n FROM audit_log").get()).toEqual({ n: 9 });
		sqlite.close();
	});

	it("handles empty history and reports storage failure to its caller", async () => {
		const { db, sqlite } = queryFixture();
		await rollupUsage(db);
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual([]);
		sqlite.exec("DROP TABLE usage_daily");
		await expect(rollupUsage(db)).rejects.toThrow();
		sqlite.close();
	});
});
