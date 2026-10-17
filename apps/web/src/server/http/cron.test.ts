import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_RETENTION_MS, runScheduledTasks } from "./cron";

describe("runScheduledTasks", () => {
	it("purges idempotency rows older than seven days", async () => {
		const now = 10_000_000;
		let bound = 0;
		const db = {
			prepare: (sql: string) => {
				expect(sql).toContain("idempotency_records");
				return {
					bind: (cutoff: number) => {
						bound = cutoff;
						return { run: async () => ({ success: true, meta: { changes: 2 } }) };
					},
				};
			},
		} as unknown as D1Database;
		const result = await runScheduledTasks({ DB: db } as import("../env").Env, now);
		expect(result.purged).toBe(2);
		expect(bound).toBe(now - IDEMPOTENCY_RETENTION_MS);
	});
});
