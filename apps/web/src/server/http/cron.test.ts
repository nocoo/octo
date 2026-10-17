import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { IDEMPOTENCY_RETENTION_MS, runScheduledTasks } from "./cron";

describe("runScheduledTasks", () => {
	it("rolls up usage and retries durable derived cleanup", async () => {
		const { db, sqlite } = sqliteD1();
		sqlite.exec(
			"INSERT INTO audit_log (id,at,actor,method,route,status,request_id,duration_ms) VALUES ('event',1000,'key:sample','GET','/api/v1/me',200,'request',1)",
		);
		sqlite.exec("INSERT INTO vector_sync_jobs (memory_id) VALUES ('purged-memory')");
		sqlite.exec(
			"INSERT INTO external_file_cleanup_jobs (r2_key,created_at) VALUES ('att/purged-memory/file',1)",
		);
		const deleted: string[] = [];
		const env = {
			DB: db,
			RESOURCE_ENV: "test",
			FILES: {
				delete: async (key: string) => {
					deleted.push(key);
				},
			},
		} as unknown as Env;
		await runScheduledTasks(env, 10000);
		expect(sqlite.prepare("SELECT calls FROM usage_daily").get()?.calls).toBe(1);
		expect(
			sqlite.prepare("SELECT synced_generation FROM vector_sync_jobs").get()?.synced_generation,
		).toBe(1);
		expect(deleted).toEqual(["att/purged-memory/file"]);
		expect(
			sqlite.prepare("SELECT count(*) AS count FROM external_file_cleanup_jobs").get()?.count,
		).toBe(0);
		await runScheduledTasks(env, 10001);
		expect(sqlite.prepare("SELECT calls FROM usage_daily").get()?.calls).toBe(1);
	});
	it("purges idempotency rows older than seven days", async () => {
		const now = 10_000_000;
		const { db, sqlite } = sqliteD1();
		const insert = sqlite.prepare(
			"INSERT INTO idempotency_records VALUES ('sample', ?, 'hash', 200, '0', ?)",
		);
		insert.run("old", now - IDEMPOTENCY_RETENTION_MS - 1);
		insert.run("boundary", now - IDEMPOTENCY_RETENTION_MS);
		const result = await runScheduledTasks({ DB: db, RESOURCE_ENV: "test" } as Env, now);
		expect(result.purged).toBe(1);
		expect(sqlite.prepare("SELECT idem_key FROM idempotency_records").all()).toEqual([
			{ idem_key: "boundary" },
		]);
	});
});
