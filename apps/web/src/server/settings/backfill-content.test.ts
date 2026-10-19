import { afterEach, expect, it, vi } from "vitest";
import { contentHash, MemoryRepo, type MemoryWrite } from "../repo/memories";
import { decodeFloat32Vector } from "../search/math";
import { fixture, SETTINGS } from "./__tests__/fixture";
import { backfillMemory } from "./backfill";
import { saveEmbeddingSettings } from "./config";

const input: MemoryWrite = {
	id: "memory",
	spaceId: "space",
	title: "ab",
	body: "c",
	type: "note",
	importance: 0.5,
	eventTime: null,
	tags: [],
	actor: "client",
	sourceKeyId: "client",
	updatedByKeyId: "client",
	op: "create",
	now: 1,
};

async function setup() {
	const context = fixture();
	context.raw.exec("INSERT INTO spaces VALUES ('space', 'space', 'Space', '', NULL, 1, 1)");
	await saveEmbeddingSettings(context.env, SETTINGS, "admin:local");
	const repo = new MemoryRepo(context.env.DB);
	const created = await repo.write(input);
	const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
		const { input: texts } = JSON.parse(String(init.body)) as { input: string[] };
		return Response.json({
			data: texts.map((text, index) => ({
				index,
				embedding: text === "ab\n\nc" ? [1, 0, 0] : [0, 1, 0],
			})),
		});
	});
	vi.stubGlobal("fetch", fetcher);
	await backfillMemory(context.env, "memory");
	return { ...context, repo, created, fetcher };
}

afterEach(() => vi.unstubAllGlobals());

it("changes provenance when title/body boundaries move without changing concatenated text", async () => {
	const { env, raw, repo, created, fetcher } = await setup();
	try {
		const updated = await repo.write({
			...input,
			title: "a",
			body: "bc",
			previous: created,
			expectedVersion: 1,
			op: "update",
			now: 2,
		});
		expect(updated.content_hash).not.toBe(created.content_hash);
		expect(await repo.vectorStatus(updated.id, updated.content_hash)).toMatchObject([
			{ stale: true },
		]);
		expect(await backfillMemory(env, updated.id)).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(
			decodeFloat32Vector(
				raw.prepare("SELECT vector FROM memory_vectors").get()?.vector as Uint8Array,
				3,
			),
		).toEqual([0, 1, 0]);
	} finally {
		raw.close();
	}
});

it("retains current stored vectors across metadata-only content-hash canonicalization", async () => {
	const { env, raw, repo, fetcher } = await setup();
	try {
		raw.exec(
			"UPDATE memories SET content_hash = 'persisted-hash'; UPDATE memory_vectors SET content_hash = 'persisted-hash'; DELETE FROM embedding_cache; INSERT INTO tags VALUES ('tag', 'tag', 'Tag', NULL, 1, 1)",
		);
		const previous = await repo.get(input.id);
		if (!previous) throw new Error("missing fixture memory");
		const updated = await repo.write({
			...input,
			tags: [{ id: "tag", name: "tag" }],
			previous,
			expectedVersion: 1,
			op: "update",
			now: 2,
		});
		expect(updated.content_hash).toBe(await contentHash(input.title, input.body));
		expect(raw.prepare("SELECT content_hash FROM memory_vectors").get()?.content_hash).toBe(
			updated.content_hash,
		);
		expect(await backfillMemory(env, updated.id)).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
	} finally {
		raw.close();
	}
});

it("does not bless a stale vector during metadata-only content-hash canonicalization", async () => {
	const { env, raw, repo, fetcher } = await setup();
	try {
		raw.exec(
			"UPDATE memories SET content_hash = 'persisted-hash'; UPDATE memory_vectors SET content_hash = 'stale-hash'; DELETE FROM embedding_cache",
		);
		const previous = await repo.get(input.id);
		if (!previous) throw new Error("missing fixture memory");
		const updated = await repo.write({
			...input,
			importance: 0.8,
			previous,
			expectedVersion: 1,
			op: "update",
			now: 2,
		});
		expect(await repo.vectorStatus(updated.id, updated.content_hash)).toMatchObject([
			{ stale: true },
		]);
		expect(await backfillMemory(env, updated.id)).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(2);
	} finally {
		raw.close();
	}
});
