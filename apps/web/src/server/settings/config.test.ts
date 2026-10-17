import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, SECRET, SETTINGS } from "./__tests__/fixture";
import {
	getEmbeddingSettings,
	loadEmbeddingConfig,
	saveEmbeddingSettings,
	testEmbeddingSettings,
} from "./config";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("embedding settings", () => {
	it("defaults to active profile, no credentials and backfill off", async () => {
		const { env } = fixture();
		expect(await getEmbeddingSettings(env)).toEqual({
			base_url: null,
			model: "tiny",
			dims: 3,
			backfill_enabled: false,
			api_key_set: false,
			api_key_mask: null,
		});
		expect(await loadEmbeddingConfig(env)).toBeNull();
	});

	it("encrypts credentials, preserves on omission, replaces and clears", async () => {
		const { env, raw } = fixture();
		await saveEmbeddingSettings(env, SETTINGS, "admin:e@local");
		const rows = raw.prepare("SELECT * FROM settings ORDER BY key").all();
		expect(JSON.stringify(rows)).not.toContain(SECRET);
		const stored = raw.prepare("SELECT * FROM settings WHERE key = 'embedding.api_key'").get();
		expect(stored).toMatchObject({ value: null, key_version: 1, updated_by: "admin:e@local" });
		expect(stored?.ciphertext).toBeInstanceOf(Uint8Array);
		expect(stored?.iv).toHaveLength(12);
		expect(await getEmbeddingSettings(env)).toEqual({
			base_url: SETTINGS.base_url,
			model: "tiny",
			dims: 3,
			backfill_enabled: true,
			api_key_set: true,
			api_key_mask: "****ABCD",
		});
		expect(await loadEmbeddingConfig(env)).toEqual({
			baseUrl: SETTINGS.base_url,
			apiKey: SECRET,
			model: "tiny",
			dims: 3,
			profileId: "tiny",
			backfillEnabled: true,
		});
		await saveEmbeddingSettings(env, { backfill_enabled: false }, "admin:e@local");
		expect(raw.prepare("SELECT * FROM settings WHERE key = 'embedding.api_key'").get()).toEqual(
			stored,
		);
		await saveEmbeddingSettings(env, { api_key: "new-secret-EFGH" }, "admin:e@local");
		expect(await getEmbeddingSettings(env)).toMatchObject({
			api_key_set: true,
			api_key_mask: "****EFGH",
			backfill_enabled: false,
		});
		await saveEmbeddingSettings(env, { api_key: "abc" }, "admin:e@local");
		expect(await getEmbeddingSettings(env)).toMatchObject({ api_key_mask: "****" });
		await saveEmbeddingSettings(env, { api_key: null, base_url: null }, "admin:e@local");
		expect(await getEmbeddingSettings(env)).toMatchObject({
			api_key_set: false,
			api_key_mask: null,
			base_url: null,
		});
		expect(await loadEmbeddingConfig(env)).toBeNull();
		expect(
			raw.prepare("SELECT * FROM settings WHERE key = 'embedding.api_key'").get(),
		).toBeUndefined();
	});

	it.each([
		{ name: "preserved credential", body: { dims: 3 } },
		{ name: "replacement credential", body: { dims: 3, api_key: "stale-credential" } },
		{ name: "cleared credential", body: { dims: 3, api_key: null } },
	])("rejects a stale partial save with $name without mixing gateway and key", async ({ body }) => {
		const { env, raw } = fixture();
		await saveEmbeddingSettings(env, SETTINGS, "admin:initial@local");
		let markPaused!: () => void;
		let resumeSave!: () => void;
		const paused = new Promise<void>((resolve) => {
			markPaused = resolve;
		});
		const resumed = new Promise<void>((resolve) => {
			resumeSave = resolve;
		});
		const batch = env.DB.batch.bind(env.DB);
		vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
			markPaused();
			await resumed;
			return batch(statements);
		});
		const staleSave = saveEmbeddingSettings(env, body, "admin:stale@local");
		const rejectedSave = expect(staleSave).rejects.toMatchObject({ code: "validation_failed" });
		await paused;
		await saveEmbeddingSettings(
			env,
			{
				base_url: "https://new-gateway.example",
				api_key: "new-gateway-credential",
				backfill_enabled: false,
			},
			"admin:new@local",
		);
		const committed = raw.prepare("SELECT * FROM settings ORDER BY key").all();
		resumeSave();
		await rejectedSave;
		expect(raw.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual(committed);
		expect(await loadEmbeddingConfig(env)).toMatchObject({
			baseUrl: "https://new-gateway.example",
			apiKey: "new-gateway-credential",
			backfillEnabled: false,
		});
	});

	it.each([
		{ dims: 2 },
		{ model: "wrong" },
		{ dims: 0 },
		{ dims: 1.2 },
		{ dims: "3" },
		{ model: "" },
		{ base_url: "http://10.0.0.1" },
		{ api_key: "" },
		{ api_key: "secret\nunsafe" },
		{ backfill_enabled: "true" },
		{ extra: SECRET },
		[],
		null,
	])("rejects invalid input without any writes (%j)", async (body) => {
		const { env, raw } = fixture();
		await expect(saveEmbeddingSettings(env, body, "admin:e@local")).rejects.toMatchObject({
			code: "validation_failed",
		});
		expect(raw.prepare("SELECT COUNT(*) AS n FROM settings").get()?.n).toBe(0);
	});

	it("requires one active profile and rejects stale stored model/dims", async () => {
		const { env, raw } = fixture();
		await saveEmbeddingSettings(env, SETTINGS, "admin:e@local");
		raw.exec("UPDATE embedding_profiles SET model = 'changed' WHERE active = 1");
		await expect(loadEmbeddingConfig(env)).rejects.toMatchObject({ code: "unavailable" });
		raw.exec("UPDATE embedding_profiles SET active = 0");
		await expect(getEmbeddingSettings(env)).rejects.toMatchObject({ code: "unavailable" });
		raw.exec("UPDATE embedding_profiles SET active = 1");
		await expect(getEmbeddingSettings(env)).rejects.toMatchObject({ code: "unavailable" });
	});

	it("does not mutate config with missing/invalid encryption key; clear can recover corrupt ciphertext", async () => {
		const { env, raw } = fixture();
		delete env.OCTO_SETTINGS_KEY;
		await expect(saveEmbeddingSettings(env, SETTINGS, "admin:e@local")).rejects.toMatchObject({
			code: "unavailable",
		});
		expect(raw.prepare("SELECT COUNT(*) AS n FROM settings").get()?.n).toBe(0);
		raw.exec(
			"INSERT INTO settings VALUES ('embedding.api_key', NULL, x'00', x'01', 1, 'admin:e@local', 1)",
		);
		await expect(getEmbeddingSettings(env)).rejects.toMatchObject({ code: "unavailable" });
		await saveEmbeddingSettings(env, { api_key: null }, "admin:e@local");
		expect(await getEmbeddingSettings(env)).toMatchObject({ api_key_set: false });
	});

	it("allows local gateway only for explicit local resource environments", async () => {
		const { env } = fixture();
		await saveEmbeddingSettings(
			env,
			{ ...SETTINGS, base_url: "http://127.0.0.1:9000" },
			"admin:e@local",
		);
		env.RESOURCE_ENV = "production";
		await expect(loadEmbeddingConfig(env)).rejects.toMatchObject({ code: "unavailable" });
	});

	it("tests fixed text using current or unsaved config, UA, without saving or exposing vectors/secrets", async () => {
		const { env, raw } = fixture();
		const fetcher = vi.fn(async (url: string, init: RequestInit) => {
			expect(url).toBe("https://gateway.example/v1/embeddings");
			expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${SECRET}`);
			expect(new Headers(init.headers).get("User-Agent")).toMatch(/^octo\//);
			expect(JSON.parse(String(init.body))).toEqual({
				model: "tiny",
				input: ["Octo embedding connection test."],
			});
			return Response.json({ data: [{ embedding: [3, 4, 0] }] });
		});
		vi.stubGlobal("fetch", fetcher);
		expect(await testEmbeddingSettings(env, SETTINGS)).toEqual({
			latency_ms: expect.any(Number),
			dims: 3,
			match: true,
			error_code: null,
		});
		expect(raw.prepare("SELECT COUNT(*) AS n FROM settings").get()?.n).toBe(0);
		await saveEmbeddingSettings(env, SETTINGS, "admin:e@local");
		expect(await testEmbeddingSettings(env, {})).toMatchObject({
			dims: 3,
			match: true,
			error_code: null,
		});
		await testEmbeddingSettings(env, { api_key: null });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("reports only safe mismatch or unavailable codes", async () => {
		const { env } = fixture();
		expect(await testEmbeddingSettings(env, {})).toMatchObject({
			dims: null,
			match: false,
			error_code: "embedder_unavailable",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1, 0] }] })),
		);
		expect(await testEmbeddingSettings(env, SETTINGS)).toMatchObject({
			dims: 2,
			match: false,
			error_code: "vector_dimension_mismatch",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error(`upstream body ${SECRET}`);
			}),
		);
		const result = await testEmbeddingSettings(env, SETTINGS);
		expect(result).toEqual({
			latency_ms: expect.any(Number),
			dims: null,
			match: false,
			error_code: "embedder_unavailable",
		});
		expect(JSON.stringify(result)).not.toContain(SECRET);
		await expect(testEmbeddingSettings(env, { dims: 2 })).rejects.toMatchObject({
			code: "validation_failed",
		});
	});
});

it("guards profile changes between validation and the atomic save", async () => {
	const { env, raw } = fixture();
	const batch = env.DB.batch.bind(env.DB);
	vi.spyOn(env.DB, "batch").mockImplementation(async (statements) => {
		raw.exec("UPDATE embedding_profiles SET dims = 2 WHERE active = 1");
		return batch(statements);
	});
	await expect(saveEmbeddingSettings(env, SETTINGS, "admin:e@local")).rejects.toMatchObject({
		code: "validation_failed",
	});
	expect(raw.prepare("SELECT COUNT(*) AS n FROM settings").get()?.n).toBe(0);
});

it("lets an admin replace a formerly-local URL after entering production", async () => {
	const { env } = fixture();
	await saveEmbeddingSettings(
		env,
		{ ...SETTINGS, base_url: "http://127.0.0.1:9000" },
		"admin:e@local",
	);
	env.RESOURCE_ENV = "production";
	await expect(loadEmbeddingConfig(env)).rejects.toMatchObject({ code: "unavailable" });
	await expect(
		saveEmbeddingSettings(env, { base_url: "https://gateway.example" }, "admin:e@local"),
	).resolves.toMatchObject({ base_url: "https://gateway.example" });
	expect(await loadEmbeddingConfig(env)).toMatchObject({ baseUrl: "https://gateway.example" });
});
