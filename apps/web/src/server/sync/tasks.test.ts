import { beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { backfillMemory } from "../settings/backfill";
import { runDerivedTasks } from "./tasks";
import { synchronizeVectors } from "./vectors";

vi.mock("../settings/backfill", () => ({ backfillMemory: vi.fn(async () => false) }));
vi.mock("./vectors", () => ({ synchronizeVectors: vi.fn(async () => ({ synced: 1, failed: 0 })) }));

describe("derived work coordination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("bounds concurrent embedding work then synchronizes explicit and backfilled vectors", async () => {
		const { db, sqlite } = sqliteD1();
		for (let index = 0; index < 58; index++)
			sqlite.prepare("INSERT INTO vector_sync_jobs (memory_id) VALUES (?)").run(`memory-${index}`);
		const env = { DB: db } as Env;
		expect(await runDerivedTasks(env, 100)).toEqual({ synced: 1, failed: 0 });
		expect(backfillMemory).toHaveBeenCalledTimes(50);
		expect(backfillMemory).toHaveBeenCalledWith(env, "memory-0");
		expect(synchronizeVectors).toHaveBeenCalledWith(env, { now: 100 });
		expect(vi.mocked(synchronizeVectors).mock.invocationCallOrder[0]).toBeGreaterThan(
			vi.mocked(backfillMemory).mock.invocationCallOrder[49] as number,
		);
	});

	it("still syncs when no backfill jobs are due", async () => {
		const { db } = sqliteD1();
		await runDerivedTasks({ DB: db } as Env);
		expect(backfillMemory).not.toHaveBeenCalled();
		expect(synchronizeVectors).toHaveBeenCalledTimes(1);
	});
});
