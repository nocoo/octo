import { afterEach, expect, it, vi } from "vitest";
import { fixture, SETTINGS } from "./__tests__/fixture";
import { backfillMemories, backfillMemory } from "./backfill";
import { saveEmbeddingSettings } from "./config";

async function setup() {
	const context = fixture();
	context.raw.exec("INSERT INTO spaces VALUES ('s', 's', 's', '', NULL, 1, 1)");
	context.raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('m', 's', 'Title', 'Body', 'note', 'source-client', 'h1', 1, 1)",
	);
	await saveEmbeddingSettings(context.env, SETTINGS, "admin:local");
	return context;
}

function gateway() {
	const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
		const { input } = JSON.parse(String(init.body)) as { input: string[] };
		return Response.json({ data: input.map(() => ({ embedding: [1, 0, 0] })) });
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("reuses persisted text embeddings after no-op, tags, requeue, and content changing away and back", async () => {
	const { env, raw } = await setup();
	const fetcher = gateway();
	expect(await backfillMemory(env, "m")).toBe(true);
	expect(await backfillMemory(env, "m")).toBe(false);
	raw.exec("INSERT INTO tags VALUES ('tag', 'tag', 'Tag', NULL, 1, 1)");
	raw.exec("INSERT INTO memory_tags (memory_id, tag_id) VALUES ('m', 'tag')");
	raw.exec("UPDATE memories SET version = version + 1 WHERE id = 'm'");
	raw.exec("UPDATE vector_sync_jobs SET due_at = 0, attempts = 0");
	expect(await backfillMemory(env, "m")).toBe(false);
	raw.exec("UPDATE memories SET body = 'Changed', content_hash = 'h2', version = 3 WHERE id = 'm'");
	expect(await backfillMemory(env, "m")).toBe(true);
	raw.exec("UPDATE memories SET body = 'Body', content_hash = 'h3', version = 4 WHERE id = 'm'");
	expect(await backfillMemory(env, "m")).toBe(true);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(
		raw.prepare("SELECT calls FROM memory_embedding_calls WHERE memory_id = 'm'").get(),
	).toEqual({ calls: 2 });
	expect(
		raw.prepare("SELECT COUNT(*) AS n FROM embedding_cache WHERE vector IS NOT NULL").get(),
	).toEqual({ n: 2 });
});

it("retains a generated vector rejected by stale version CAS and uses it on retry", async () => {
	const { env, raw } = await setup();
	const fetcher = gateway();
	fetcher.mockImplementationOnce(async () => {
		raw.exec("UPDATE memories SET version = 2 WHERE id = 'm'");
		return Response.json({ data: [{ embedding: [1, 0, 0] }] });
	});
	expect(await backfillMemory(env, "m")).toBe(false);
	expect(await backfillMemory(env, "m")).toBe(true);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("batches distinct cache misses, deduplicates equal text, and counts only outbound attempts", async () => {
	const { env, raw } = await setup();
	raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('n', 's', 'Other', 'Body', 'note', 'source-client', 'h1', 1, 1), ('copy', 's', 'Title', 'Body', 'note', 'source-client', 'different-hash', 1, 1)",
	);
	const fetcher = gateway();
	expect(await backfillMemories(env, ["m", "n", "copy", "m", "missing"])).toBe(3);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(JSON.parse(String(fetcher.mock.calls[0]?.[1].body)).input).toEqual([
		"Title\n\nBody",
		"Other\n\nBody",
	]);
	expect(
		raw.prepare("SELECT memory_id, calls FROM memory_embedding_calls ORDER BY memory_id").all(),
	).toEqual([
		{ memory_id: "copy", calls: 1 },
		{ memory_id: "m", calls: 1 },
		{ memory_id: "n", calls: 1 },
	]);
	expect(await backfillMemories(env, ["m", "n", "copy"])).toBe(0);
	expect(await backfillMemories(env, [])).toBe(0);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("durably claims shared cache keys and rejects busy work instead of acknowledging missing vectors", async () => {
	const { env, raw } = await setup();
	raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('copy', 's', 'Title', 'Body', 'note', 'source-client', 'different-hash', 1, 1)",
	);
	let release = () => {};
	let started = () => {};
	const entered = new Promise<void>((resolve) => {
		started = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const fetcher = vi.fn(async () => {
		started();
		await held;
		return Response.json({ data: [{ embedding: [1, 0, 0] }] });
	});
	vi.stubGlobal("fetch", fetcher);
	vi.spyOn(console, "error").mockImplementation(() => {});
	const first = backfillMemory(env, "m");
	await entered;
	await expect(backfillMemory(env, "copy")).rejects.toMatchObject({ code: "unavailable" });
	expect(fetcher).toHaveBeenCalledTimes(1);
	release();
	expect(await first).toBe(true);
	expect(await backfillMemory(env, "copy")).toBe(true);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(
		raw.prepare("SELECT calls FROM memory_embedding_calls WHERE memory_id = 'copy'").get(),
	).toBeUndefined();
});

it.each([429, 500, 503])(
	"propagates HTTP %i and retries without leaving a cache lease",
	async (status) => {
		const { env, raw } = await setup();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fetcher = gateway();
		fetcher.mockImplementationOnce(async () => new Response(null, { status }));
		await expect(backfillMemories(env, ["m"])).rejects.toMatchObject({
			reason: { stage: "status", upstream_status: status },
		});
		expect(await backfillMemory(env, "m")).toBe(true);
		expect(await backfillMemory(env, "m")).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(raw.prepare("SELECT calls FROM memory_embedding_calls").get()).toEqual({ calls: 2 });
	},
);

it("skips URL validation and decrypt for a current client vector and for cached text", async () => {
	const { env, raw } = await setup();
	const fetcher = gateway();
	expect(await backfillMemory(env, "m")).toBe(true);
	raw.exec("UPDATE settings SET ciphertext = x'00' WHERE key = 'embedding.api_key'");
	raw.exec("UPDATE settings SET value = 'invalid URL' WHERE key = 'embedding.base_url'");
	expect(await backfillMemory(env, "m")).toBe(false);
	raw.exec("DELETE FROM memory_vectors WHERE memory_id = 'm'");
	expect(await backfillMemory(env, "m")).toBe(true);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("never calls the model for a client-supplied current vector even with broken gateway configuration", async () => {
	const { env, raw } = await setup();
	raw.exec(
		"INSERT INTO memory_vectors VALUES ('m', 'tiny', 'tiny', 3, x'0000803f0000000000000000', 'h1', NULL, 1)",
	);
	raw.exec("UPDATE settings SET ciphertext = x'00' WHERE key = 'embedding.api_key'");
	raw.exec("UPDATE settings SET value = 'invalid URL' WHERE key = 'embedding.base_url'");
	const fetcher = gateway();
	expect(await backfillMemory(env, "m")).toBe(false);
	expect(fetcher).not.toHaveBeenCalled();
	expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_embedding_calls").get()).toEqual({ n: 0 });
});

it("rolls back all memory-vector writes on batch failure and retries entirely from the durable cache", async () => {
	const { env, raw } = await setup();
	raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('n', 's', 'Other', 'Body', 'note', 'source-client', 'h1', 1, 1)",
	);
	const fetcher = gateway();
	vi.spyOn(console, "error").mockImplementation(() => {});
	const generations = raw
		.prepare("SELECT memory_id, generation FROM vector_sync_jobs ORDER BY memory_id")
		.all();
	const prepare = env.DB.prepare.bind(env.DB);
	let writes = 0;
	const mock = vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
		const statement = prepare(sql);
		if (sql.startsWith("INSERT INTO memory_vectors") && ++writes === 2)
			vi.spyOn(statement, "run").mockRejectedValue(new Error("private-storage-detail"));
		return statement;
	});
	await expect(backfillMemories(env, ["m", "n"])).rejects.toMatchObject({
		reason: { stage: "config" },
	});
	expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_vectors").get()).toEqual({ n: 0 });
	expect(
		raw.prepare("SELECT memory_id, generation FROM vector_sync_jobs ORDER BY memory_id").all(),
	).toEqual(generations);
	mock.mockRestore();
	expect(await backfillMemories(env, ["m", "n"])).toBe(2);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects a lost cache lease before any memory vector is written", async () => {
	const { env, raw } = await setup();
	vi.spyOn(console, "error").mockImplementation(() => {});
	const fetcher = gateway();
	fetcher.mockImplementationOnce(async () => {
		raw.exec("UPDATE embedding_cache SET lease_token = 'other-owner'");
		return Response.json({ data: [{ embedding: [1, 0, 0] }] });
	});
	await expect(backfillMemory(env, "m")).rejects.toMatchObject({
		code: "unavailable",
		message: "embedding cache claim lost",
	});
	expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_vectors").get()).toEqual({ n: 0 });
	expect(raw.prepare("SELECT lease_token FROM embedding_cache").get()).toEqual({
		lease_token: "other-owner",
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("separates identical text by model and dimensions and reuses previous profile configurations", async () => {
	const { env, raw } = await setup();
	const fetcher = vi.fn(async () => {
		const dims = raw.prepare("SELECT dims FROM embedding_profiles WHERE id = 'tiny'").get()?.dims;
		return Response.json({ data: [{ embedding: dims === 2 ? [1, 0] : [1, 0, 0] }] });
	});
	vi.stubGlobal("fetch", fetcher);
	expect(await backfillMemory(env, "m")).toBe(true);
	for (const [model, dims] of [
		["other", 3],
		["tiny", 3],
		["tiny", 2],
		["tiny", 3],
	] as const) {
		raw
			.prepare("UPDATE embedding_profiles SET model = ?, dims = ? WHERE id = 'tiny'")
			.run(model, dims);
		raw.prepare("UPDATE settings SET value = ? WHERE key = 'embedding.model'").run(model);
		raw.prepare("UPDATE settings SET value = ? WHERE key = 'embedding.dims'").run(String(dims));
		expect(await backfillMemory(env, "m")).toBe(true);
	}
	expect(fetcher).toHaveBeenCalledTimes(3);
	expect(raw.prepare("SELECT COUNT(*) AS n FROM embedding_cache").get()).toEqual({ n: 3 });
	expect(raw.prepare("SELECT calls FROM memory_embedding_calls").get()).toEqual({ calls: 3 });
});
