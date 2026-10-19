import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, MASTER_KEY, SECRET, SETTINGS } from "./__tests__/fixture";
import { searchAdminMemories } from "./admin-search";
import { backfillMemory } from "./backfill";
import { saveEmbeddingSettings, testEmbeddingSettings } from "./config";

vi.mock("../search/service", () => ({
	searchMemories: vi.fn(async () => ({ items: [], channels: {} })),
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const operations = [
	{
		event: "embedding_test_failed",
		run: (env: ReturnType<typeof fixture>["env"]) => testEmbeddingSettings(env, {}),
	},
	{
		event: "embedding_backfill_failed",
		run: (env: ReturnType<typeof fixture>["env"]) =>
			backfillMemory(env, "m").catch((error: unknown) => error),
	},
	{
		event: "embedding_query_failed",
		run: (env: ReturnType<typeof fixture>["env"]) =>
			searchAdminMemories(
				env,
				{ keyId: "admin:local", visibleSpaceIds: "all" },
				{ query: "private-query" },
			),
	},
];

async function setup() {
	const context = fixture();
	context.raw.exec(
		"INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('s', 's', 's', 1, 1)",
	);
	context.raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('m', 's', 'private-title', 'private-body', 'note', 'source-client', 'hash', 1, 1)",
	);
	await saveEmbeddingSettings(
		context.env,
		{ ...SETTINGS, base_url: "https://gateway.example/private-path/v1" },
		"admin:local",
	);
	return context;
}

describe.each(operations)("$event", ({ event, run }) => {
	it.each(["request", "parse", "dims"])("logs %s failures without raw data", async (stage) => {
		const { env } = await setup();
		const logger = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (stage === "request") throw new Error(`${SECRET} private-body private-query`);
				if (stage === "parse") return new Response(`${SECRET} private-body`);
				return Response.json({ data: [{ embedding: [1] }] });
			}),
		);
		const result = await run(env);
		expect(logger.mock.calls).toEqual([[{ event, stage, host: "gateway.example" }]]);
		if (event === "embedding_test_failed") expect(result).toMatchObject({ reason: { stage } });
		expect(JSON.stringify([logger.mock.calls, result])).not.toContain(SECRET);
	});

	it.each(["master", "ciphertext", "iv", "version"])(
		"logs %s decrypt failure without leaking configuration",
		async (failure) => {
			const { env, raw } = await setup();
			if (failure === "master") env.OCTO_SETTINGS_KEY = btoa("x".repeat(32));
			else if (failure === "ciphertext")
				raw.exec("UPDATE settings SET ciphertext = x'00' WHERE key = 'embedding.api_key'");
			else if (failure === "iv")
				raw.exec("UPDATE settings SET iv = x'00' WHERE key = 'embedding.api_key'");
			else raw.exec("UPDATE settings SET key_version = 2 WHERE key = 'embedding.api_key'");
			const logger = vi.spyOn(console, "error").mockImplementation(() => {});
			const fetcher = vi.fn();
			vi.stubGlobal("fetch", fetcher);
			const result = await run(env);
			expect(logger.mock.calls).toEqual([[{ event, stage: "decrypt", host: "gateway.example" }]]);
			if (event === "embedding_test_failed")
				expect(result).toMatchObject({
					error_code: "embedder_unavailable",
					reason: { stage: "decrypt" },
				});
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it.each([401, 403, 302, 500])("logs safe upstream status %i only", async (status) => {
		const { env } = await setup();
		const logger = vi.spyOn(console, "error").mockImplementation(() => {});
		const upstream = new Response(`${SECRET} private-body`, {
			status,
			headers: { Location: "https://private.example/secret" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => upstream),
		);
		const result = await run(env);
		const reason = { stage: status === 302 ? "redirect" : "status", upstream_status: status };
		expect(logger.mock.calls).toEqual([[{ event, ...reason, host: "gateway.example" }]]);
		if (event === "embedding_test_failed")
			expect(result).toMatchObject({ error_code: "embedder_unavailable", reason });
		expect(upstream.bodyUsed).toBe(false);
		for (const sensitive of [
			SECRET,
			MASTER_KEY,
			"private-path",
			"private-body",
			"private-query",
			"Location",
			"Authorization",
		])
			expect(JSON.stringify([logger.mock.calls, result])).not.toContain(sensitive);
	});
});

it("tests an unsaved key and URL over broken stored credentials without persisting", async () => {
	const { env, raw } = await setup();
	raw.exec("UPDATE settings SET ciphertext = x'00' WHERE key = 'embedding.api_key'");
	const before = raw.prepare("SELECT * FROM settings ORDER BY key").all();
	const logger = vi.spyOn(console, "error").mockImplementation(() => {});
	const fetcher = vi.fn(async () => Response.json({ data: [{ embedding: [1, 0, 0] }] }));
	vi.stubGlobal("fetch", fetcher);
	const result = await testEmbeddingSettings(env, {
		base_url: "https://override.example/v1/",
		api_key: "unsaved-private-key",
	});
	expect(result).toMatchObject({ match: true, reason: null });
	expect(fetcher).toHaveBeenCalledWith(
		"https://override.example/v1/embeddings",
		expect.objectContaining({
			headers: expect.objectContaining({ Authorization: "Bearer unsaved-private-key" }),
		}),
	);
	expect(raw.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual(before);
	expect(logger).not.toHaveBeenCalled();
});

it("round-trips an 83-byte ciphertext through D1 hex and the stored-key test path", async () => {
	const { env, raw } = fixture();
	const credential = "synthetic-".padEnd(67, "x");
	await saveEmbeddingSettings(env, { ...SETTINGS, api_key: credential }, "admin:local");
	expect(
		raw
			.prepare(
				"SELECT length(ciphertext) AS bytes, length(iv) AS iv_bytes, key_version FROM settings WHERE key = 'embedding.api_key'",
			)
			.get(),
	).toMatchObject({ bytes: 83, iv_bytes: 12, key_version: 1 });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: RequestInit) => {
			expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${credential}`);
			return Response.json({ data: [{ embedding: [1, 0, 0] }] });
		}),
	);
	expect(await testEmbeddingSettings(env, {})).toMatchObject({ match: true, reason: null });
});
