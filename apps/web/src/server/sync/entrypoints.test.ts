import { afterEach, describe, expect, it, vi } from "vitest";
import { runScheduledTasks } from "../http/cron";
import { memoryInput, setup } from "../mcp/__tests__/app";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { encodeFloat32Vector } from "../search/math";

afterEach(() => vi.restoreAllMocks());

describe("derived synchronization entrypoints", () => {
	it.each(["cron", "mcp"])(
		"finishes overlapping MCP writes inside the %s holder",
		async (holder) => {
			const { call, env, sqlite, tasks, flush } = await setup();
			const created = (await call("create_memory", memoryInput)).result;
			expect(created.isError).not.toBe(true);
			await flush();
			const memoryId = String(created.structuredContent.id);
			sqlite.exec("UPDATE embedding_profiles SET dims = 2");
			sqlite
				.prepare(`INSERT INTO memory_vectors
			(memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
			SELECT id, 'te3-small-1536', 'text-embedding-3-small', 2, ?, content_hash, updated_at
			FROM memories WHERE id = ?`)
				.run(encodeFloat32Vector([1, 0]), memoryId);
			const upsert = vi.spyOn(D1BruteForceVectorStore.prototype, "upsert");
			upsert.mockImplementationOnce(async () => {
				const previousTasks = tasks.length;
				const updated = (
					await call("update_memory", {
						id: memoryId,
						patch: { expected_version: holder === "mcp" ? 2 : 1, importance: 0.8 },
					})
				).result;
				expect(updated.isError).not.toBe(true);
				await Promise.all(tasks.slice(previousTasks));
				expect(upsert).toHaveBeenCalledTimes(1);
				expect(
					sqlite.prepare("SELECT indexed_at FROM memory_vectors").get()?.indexed_at,
				).toBeNull();
			});
			if (holder === "cron") {
				await runScheduledTasks(env);
			} else {
				const updated = (
					await call("update_memory", {
						id: memoryId,
						patch: { expected_version: 1, type: "fact" },
					})
				).result;
				expect(updated.isError).not.toBe(true);
				await flush();
			}
			expect(upsert).toHaveBeenCalledTimes(2);
			expect(upsert).toHaveBeenLastCalledWith([
				expect.objectContaining({
					id: memoryId,
					metadata: expect.objectContaining({ importance: 0.8 }),
				}),
			]);
			expect(sqlite.prepare("SELECT indexed_at FROM memory_vectors").get()?.indexed_at).toEqual(
				expect.any(Number),
			);
			const job = sqlite
				.prepare("SELECT * FROM vector_sync_jobs WHERE memory_id = ?")
				.get(memoryId);
			expect(job?.synced_generation).toBe(job?.generation);
			expect(job).toMatchObject({ lease_until: 0, lease_token: null });
		},
	);
});
