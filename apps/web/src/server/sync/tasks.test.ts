import { afterEach, describe, expect, it, vi } from "vitest";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { encodeFloat32Vector } from "../search/math";
import { fixture, SETTINGS } from "../settings/__tests__/fixture";
import { saveEmbeddingSettings } from "../settings/config";
import { runDerivedTasks } from "./tasks";
import { SYNC_LEASE_MS } from "./vectors";

async function setup(count: number) {
	const { env, raw } = fixture();
	raw.exec("INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('s','s','s',1,1)");
	for (let index = 0; index < count; index++)
		raw
			.prepare(`INSERT INTO memories
			(id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
			VALUES (?,'s','Title','Body','note','client','hash',1,1)`)
			.run(`memory-${String(index).padStart(2, "0")}`);
	await saveEmbeddingSettings(env, SETTINGS, "admin:e@local");
	return { env, raw };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("derived work coordination", () => {
	it("honors the small bulk budget without freezing the live synchronization clock", async () => {
		const { env, raw } = await setup(6);
		let now = 100;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				now += 100;
				return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] });
			}),
		);
		try {
			expect(await runDerivedTasks(env, undefined, undefined, 5)).toEqual({ synced: 5, failed: 0 });
			expect(
				raw.prepare("SELECT MIN(indexed_at) AS at FROM memory_vectors").get()?.at,
			).toBeGreaterThan(100);
			expect(
				raw
					.prepare("SELECT count(*) AS count FROM vector_sync_jobs WHERE synced_generation IS NULL")
					.get()?.count,
			).toBe(1);
		} finally {
			raw.close();
		}
	});

	it("repairs a newer client PUT when the old embedding holder fails", async () => {
		const { env, raw } = await setup(1);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.spyOn(D1BruteForceVectorStore.prototype, "upsert");
		const fetcher = vi.fn(async () => {
			raw.exec("UPDATE memories SET body = 'New body', content_hash = 'new-hash', version = 2");
			raw
				.prepare(`INSERT INTO memory_vectors
				(memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
				VALUES ('memory-00','tiny','tiny',3,?,'new-hash',2)`)
				.run(encodeFloat32Vector([0, 1, 0]));
			expect(await runDerivedTasks(env, 101, ["memory-00"])).toEqual({ synced: 0, failed: 0 });
			return new Response(null, { status: 429 });
		});
		vi.stubGlobal("fetch", fetcher);
		try {
			expect(await runDerivedTasks(env, 100, ["memory-00"])).toEqual({ synced: 1, failed: 1 });
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(upsert).toHaveBeenCalledTimes(1);
			expect(upsert).toHaveBeenCalledWith([expect.objectContaining({ values: [0, 1, 0] })]);
			expect(raw.prepare("SELECT indexed_at FROM memory_vectors").get()?.indexed_at).toBe(100);
			expect(
				raw
					.prepare(
						"SELECT generation = synced_generation AS synced, attempts, dead_at FROM vector_sync_jobs",
					)
					.get(),
			).toEqual({ synced: 1, attempts: 0, dead_at: null });
		} finally {
			raw.close();
			log.mockRestore();
		}
	});

	it("batches shared content once and fences concurrent cron/write drains", async () => {
		const { env, raw } = await setup(50);
		raw.exec("INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-purge-tombstone')");
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				calls++;
				entered.resolve();
				await release.promise;
				return Response.json({ data: [{ embedding: [1, 0, 0] }] });
			}),
		);
		const abandoned = runDerivedTasks(env, 100);
		await entered.promise;
		try {
			expect(
				raw
					.prepare(`SELECT count(*) AS count FROM vector_sync_jobs
				WHERE lease_token IS NOT NULL AND lease_until = ? AND due_at = 100`)
					.get(100 + SYNC_LEASE_MS)?.count,
			).toBe(4);
			expect(await runDerivedTasks(env, 101)).toEqual({ synced: 0, failed: 47 });
			expect(calls).toBe(1);
			expect(
				raw
					.prepare(
						"SELECT synced_generation FROM vector_sync_jobs WHERE memory_id = 'z-purge-tombstone'",
					)
					.get()?.synced_generation,
			).toBeNull();
			release.resolve();
			expect(await abandoned).toEqual({ synced: 4, failed: 0 });
			const recoveredAt = 101 + 2 * 60 * 60 * 1000;
			await runDerivedTasks(env, recoveredAt);
			await runDerivedTasks(env, recoveredAt);
			expect(calls).toBe(1);
			expect(
				raw
					.prepare("SELECT count(*) AS count FROM memory_vectors WHERE indexed_at IS NOT NULL")
					.get()?.count,
			).toBe(50);
		} finally {
			release.resolve();
			await abandoned;
			raw.close();
			log.mockRestore();
		}
	});

	it("acknowledges the generation created by backfill in the same drain", async () => {
		const { env, raw } = await setup(1);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1, 0, 0] }] })),
		);
		try {
			expect(await runDerivedTasks(env, 100)).toEqual({ synced: 1, failed: 0 });
			expect(raw.prepare("SELECT indexed_at FROM memory_vectors").get()?.indexed_at).toBe(100);
			expect(
				raw.prepare("SELECT generation = synced_generation AS synced FROM vector_sync_jobs").get()
					?.synced,
			).toBe(1);
		} finally {
			raw.close();
		}
	});

	it("preserves and syncs current client vectors without a gateway call", async () => {
		const { env, raw } = await setup(1);
		raw
			.prepare(`INSERT INTO memory_vectors
			(memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
			VALUES ('memory-00','tiny','tiny',3,?,'hash',1)`)
			.run(encodeFloat32Vector([0, 1, 0]));
		const gateway = vi.fn();
		vi.stubGlobal("fetch", gateway);
		try {
			expect(await runDerivedTasks(env, 100)).toEqual({ synced: 1, failed: 0 });
			expect(gateway).not.toHaveBeenCalled();
			expect(raw.prepare("SELECT indexed_at FROM memory_vectors").get()?.indexed_at).toBe(100);
			expect(await runDerivedTasks(env)).toEqual({ synced: 1, failed: 0 });
			expect(raw.prepare("SELECT source_key_id FROM memories").get()?.source_key_id).toBe("client");
		} finally {
			raw.close();
		}
	});

	it("does no work for an empty queue", async () => {
		const { env, raw } = await setup(0);
		try {
			expect(await runDerivedTasks(env)).toEqual({ synced: 0, failed: 0 });
		} finally {
			raw.close();
		}
	});
});
