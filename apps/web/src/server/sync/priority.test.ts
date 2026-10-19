import { afterEach, expect, it, vi } from "vitest";
import { encodeFloat32Vector } from "../search/math";
import { fixture, SETTINGS } from "../settings/__tests__/fixture";
import { backfillMemories } from "../settings/backfill";
import { saveEmbeddingSettings } from "../settings/config";
import { synchronizeVectors } from "./vectors";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function setup(count: number) {
	const { env, raw } = fixture();
	raw.exec("INSERT INTO spaces VALUES ('space', 'space', 'Space', '', NULL, 1, 1)");
	const ids = Array.from(
		{ length: count },
		(_, index) => `memory-${String(index).padStart(2, "0")}`,
	);
	for (const id of ids) {
		raw
			.prepare(`INSERT INTO memories
			(id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
			VALUES (?,'space',?,'Body','note','client','hash',1,1)`)
			.run(id, id);
	}
	await saveEmbeddingSettings(env, SETTINGS, "admin:local");
	let now = 100;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
		const input = (JSON.parse(String(init.body)) as { input: string[] }).input;
		now += 3000;
		return Response.json({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) });
	});
	vi.stubGlobal("fetch", fetcher);
	const store = {
		upsert: vi.fn(async (_entries: VectorizeVector[]) => {}),
		delete: vi.fn(async (_ids: string[]) => {}),
	};
	const process = (memoryIds?: string[]) =>
		synchronizeVectors(env, {
			store,
			...(memoryIds === undefined ? {} : { memoryIds }),
			beforeSyncBatch: (batch) => backfillMemories(env, batch),
		});
	const put = (id: string, values: number[]) =>
		raw
			.prepare(`INSERT INTO memory_vectors
		(memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
		VALUES (?,'tiny','tiny',3,?,'hash',1)
		ON CONFLICT(memory_id,profile_id) DO UPDATE SET vector=excluded.vector, indexed_at=NULL`)
			.run(id, encodeFloat32Vector(values));
	const indexed = (id: string) =>
		raw.prepare("SELECT indexed_at FROM memory_vectors WHERE memory_id=?").get(id)?.indexed_at;
	return { env, raw, ids, store, process, put, indexed, fetcher, clock: () => now };
}

it("indexes ready clients and sends deletions before any unrelated embedding groups", async () => {
	const context = await setup(17);
	const { raw, ids, put, process, indexed, store, clock, fetcher } = context;
	put("memory-16", [0, 1, 0]);
	raw.exec("INSERT INTO vector_sync_jobs(memory_id) VALUES ('z-deleted')");
	let deletionAt: number | undefined;
	store.delete.mockImplementation(async () => {
		deletionAt = clock();
	});
	try {
		expect(await process([...ids, "z-deleted"])).toEqual({ synced: 18, failed: 0 });
		expect(indexed("memory-16")).toBe(100);
		expect(deletionAt).toBe(100);
		expect(fetcher).toHaveBeenCalledTimes(4);
	} finally {
		raw.close();
	}
});

it("repairs a single PUT behind a cron-owned lease before unrelated embedding batches", async () => {
	const { raw, put, process, indexed, store, clock, fetcher } = await setup(21);
	put("memory-00", [1, 0, 0]);
	let putAt: number | undefined;
	store.upsert.mockImplementationOnce(async () => {
		putAt = clock();
		put("memory-00", [0, 1, 0]);
		expect(await process(["memory-00"])).toEqual({ synced: 0, failed: 0 });
	});
	try {
		expect(await process()).toEqual({ synced: 21, failed: 0 });
		expect(putAt).toBe(100);
		expect(indexed("memory-00")).toBe(putAt);
		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(store.upsert.mock.calls[1]?.[0][0]?.values).toEqual([0, 1, 0]);
	} finally {
		raw.close();
	}
});

it("does not let readiness changes in later groups delay a leased client repair", async () => {
	const { raw, ids, put, process, indexed, store, clock } = await setup(21);
	for (const id of ids) put(id, [1, 0, 0]);
	let putAt: number | undefined;
	store.upsert.mockImplementationOnce(async () => {
		putAt = clock();
		put("memory-00", [0, 1, 0]);
		raw.exec("UPDATE memories SET content_hash='changed' WHERE id > 'memory-03'");
		expect(await process(["memory-00"])).toEqual({ synced: 0, failed: 0 });
	});
	try {
		expect(await process()).toEqual({ synced: 21, failed: 0 });
		expect(indexed("memory-00")).toBe(putAt);
	} finally {
		raw.close();
	}
});
