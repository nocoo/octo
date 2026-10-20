import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { encodeFloat32Vector } from "../search/math";
import { FAILURE_BACKOFF_MS, SYNC_LEASE_MS } from "../sync/vectors";
import { IDEMPOTENCY_RETENTION_MS, runScheduledTasks } from "./cron";

afterEach(() => vi.restoreAllMocks());

describe("runScheduledTasks", () => {
	it("uses the live clock for queued vector leases and failure backoff", async () => {
		const { db, sqlite } = sqliteD1();
		const clock = vi.spyOn(Date, "now").mockReturnValue(100);
		vi.spyOn(console, "error").mockImplementation(() => {});
		sqlite.exec("UPDATE embedding_profiles SET dims = 2");
		for (let index = 0; index < 5; index++) {
			const memoryId = `job-${index}`;
			sqlite
				.prepare(`INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at)
				VALUES (?, 'space:kb', '', '', 'note', 'source', 'hash', 1, 1)`)
				.run(memoryId);
			sqlite
				.prepare(`INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
				VALUES (?, 'te3-small-1536', 'text-embedding-3-small', 2, ?, 'hash', 1)`)
				.run(memoryId, encodeFloat32Vector([1, 0]));
		}
		sqlite.exec("INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-deleted')");
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		let fifthLease: unknown;
		vi.spyOn(D1BruteForceVectorStore.prototype, "upsert").mockImplementation(async () => {
			calls++;
			if (calls <= 4) {
				if (calls === 4) entered.resolve();
				await release.promise;
			} else {
				fifthLease = sqlite
					.prepare("SELECT lease_until FROM vector_sync_jobs WHERE memory_id = 'job-4'")
					.get()?.lease_until;
			}
		});
		vi.spyOn(D1BruteForceVectorStore.prototype, "delete").mockImplementation(async () => {
			clock.mockReturnValue(101 + 2 * SYNC_LEASE_MS);
			throw new Error("service unavailable");
		});
		const scheduled = runScheduledTasks({ DB: db, RESOURCE_ENV: "test" } as Env);
		await entered.promise;
		clock.mockReturnValue(101 + SYNC_LEASE_MS);
		release.resolve();
		await scheduled;
		expect(fifthLease).toBe(101 + 2 * SYNC_LEASE_MS);
		expect(
			sqlite.prepare("SELECT due_at FROM vector_sync_jobs WHERE memory_id = 'z-deleted'").get()
				?.due_at,
		).toBe(Date.now() + 2 * FAILURE_BACKOFF_MS);
	});

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
