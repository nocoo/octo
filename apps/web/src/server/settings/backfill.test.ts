import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, SECRET, SETTINGS } from "./__tests__/fixture";
import { BACKFILL_TEXT_MAX_CHARS, backfillMemory } from "./backfill";
import { saveEmbeddingSettings } from "./config";

async function setup(config: unknown = SETTINGS) {
	const { env, raw } = fixture();
	raw.exec(
		"INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('s', 's', 's', 1, 1)",
	);
	raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('m', 's', 'Title', 'Body', 'note', 'source-client', 'hash-1', 1, 1)",
	);
	await saveEmbeddingSettings(env, config, "admin:e@local");
	return { env, raw };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("post-commit embedding backfill", () => {
	it("reports a changed vector when D1 includes trigger writes in changes", async () => {
		const { env } = await setup();
		const prepare = env.DB.prepare.bind(env.DB);
		vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
			const statement = prepare(sql);
			if (!sql.startsWith("INSERT INTO memory_vectors")) return statement;
			const bind = statement.bind.bind(statement);
			vi.spyOn(statement, "bind").mockImplementation((...values) => {
				const bound = bind(...values);
				const run = bound.run.bind(bound);
				vi.spyOn(bound, "run").mockImplementation(async () => {
					const result = await run();
					return { ...result, meta: { ...result.meta, changes: result.meta.changes * 3 } };
				});
				return bound;
			});
			return statement;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1, 0, 0] }] })),
		);
		expect(await backfillMemory(env, "m")).toBe(true);
		expect(await backfillMemory(env, "m")).toBe(false);
	});

	it("defaults off and makes no outbound call for missing config/memory or trashed memories", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const empty = fixture();
		expect(await backfillMemory(empty.env, "m")).toBe(false);
		const { env, raw } = await setup({ ...SETTINGS, backfill_enabled: false });
		expect(await backfillMemory(env, "m")).toBe(false);
		await saveEmbeddingSettings(env, { backfill_enabled: true }, "admin:e@local");
		expect(await backfillMemory(env, "missing")).toBe(false);
		raw.exec("UPDATE memories SET deleted_at = 2 WHERE id = 'm'");
		expect(await backfillMemory(env, "m")).toBe(false);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("embeds committed text and stores a normalized pending vector without changing source/history", async () => {
		const { env, raw } = await setup();
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			expect(JSON.parse(String(init.body))).toEqual({ model: "tiny", input: ["Title\n\nBody"] });
			expect(new Headers(init.headers).get("User-Agent")).toMatch(/^octo\//);
			expect(raw.prepare("SELECT title FROM memories WHERE id = 'm'").get()?.title).toBe("Title");
			return Response.json({ data: [{ embedding: [3, 4, 0] }] });
		});
		vi.stubGlobal("fetch", fetcher);
		expect(await backfillMemory(env, "m")).toBe(true);
		const vector = raw.prepare("SELECT * FROM memory_vectors WHERE memory_id = 'm'").get();
		expect(vector).toMatchObject({
			profile_id: "tiny",
			embedding_model: "tiny",
			dim: 3,
			content_hash: "hash-1",
			indexed_at: null,
		});
		const bytes = vector?.vector as Uint8Array;
		const floats = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		expect(floats.getFloat32(0, true)).toBeCloseTo(0.6);
		expect(floats.getFloat32(4, true)).toBeCloseTo(0.8);
		expect(
			raw.prepare("SELECT source_key_id, version FROM memories WHERE id = 'm'").get(),
		).toMatchObject({ source_key_id: "source-client", version: 1 });
		expect(raw.prepare("SELECT COUNT(*) AS n FROM changes").get()?.n).toBe(0);
		expect(await backfillMemory(env, "m")).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("replaces stale vectors and resets indexed_at but skips current client vectors", async () => {
		const { env, raw } = await setup();
		raw.exec(
			"INSERT INTO memory_vectors VALUES ('m', 'tiny', 'tiny', 3, x'0000803f0000000000000000', 'old-hash', 123, 1)",
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [0, 1, 0] }] })),
		);
		expect(await backfillMemory(env, "m")).toBe(true);
		expect(raw.prepare("SELECT indexed_at, content_hash FROM memory_vectors").get()).toMatchObject({
			indexed_at: null,
			content_hash: "hash-1",
		});
		raw.exec("UPDATE memory_vectors SET dim = 2, embedding_model = 'old-model', indexed_at = 200");
		expect(await backfillMemory(env, "m")).toBe(true);
	});

	it("bounds title + separator + body before sending to gateway", async () => {
		const { env, raw } = await setup();
		raw
			.prepare("UPDATE memories SET body = ? WHERE id = 'm'")
			.run("x".repeat(BACKFILL_TEXT_MAX_CHARS * 2));
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				const { input } = JSON.parse(String(init.body)) as { input: string[] };
				expect(input[0]).toBe(`Title\n\n${"x".repeat(BACKFILL_TEXT_MAX_CHARS - 7)}`);
				return Response.json({ data: [{ embedding: [1, 0, 0] }] });
			}),
		);
		expect(await backfillMemory(env, "m")).toBe(true);
	});

	it.each([
		["content", "UPDATE memories SET content_hash = 'new-hash' WHERE id = 'm'"],
		["version", "UPDATE memories SET version = 2 WHERE id = 'm'"],
		["trash", "UPDATE memories SET deleted_at = 3 WHERE id = 'm'"],
		["purge", "DELETE FROM memories WHERE id = 'm'"],
		["profile model", "UPDATE embedding_profiles SET model = 'other' WHERE id = 'tiny'"],
		["profile dims", "UPDATE embedding_profiles SET dims = 2 WHERE id = 'tiny'"],
		["profile active", "UPDATE embedding_profiles SET active = 0 WHERE id = 'tiny'"],
		["profile ambiguity", "UPDATE embedding_profiles SET active = 1"],
		["settings model", "UPDATE settings SET value = 'other' WHERE key = 'embedding.model'"],
		["settings dims", "UPDATE settings SET value = '2' WHERE key = 'embedding.dims'"],
		[
			"settings toggle",
			"UPDATE settings SET value = 'false' WHERE key = 'embedding.backfill_enabled'",
		],
		[
			"settings URL",
			"UPDATE settings SET value = 'https://new.example' WHERE key = 'embedding.base_url'",
		],
		["settings key", "UPDATE settings SET ciphertext = x'00' WHERE key = 'embedding.api_key'"],
		["settings IV", "UPDATE settings SET iv = x'00' WHERE key = 'embedding.api_key'"],
		["settings version", "UPDATE settings SET key_version = 2 WHERE key = 'embedding.api_key'"],
		[
			"settings metadata",
			"UPDATE settings SET updated_at = updated_at + 1 WHERE key = 'embedding.base_url'",
		],
		[
			"settings addition",
			"INSERT INTO settings VALUES ('embedding.future', 'x', NULL, NULL, NULL, 'admin:e@local', 1)",
		],
		["settings removal", "DELETE FROM settings WHERE key = 'embedding.backfill_enabled'"],
	])("discards vector after concurrent %s change", async (_name, sql) => {
		const { env, raw } = await setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				raw.exec(sql);
				return Response.json({ data: [{ embedding: [1, 0, 0] }] });
			}),
		);
		expect(await backfillMemory(env, "m")).toBe(false);
		expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_vectors").get()?.n).toBe(0);
	});

	it.each([false, true])(
		"never overwrites a concurrent current client vector (stale initially: %s)",
		async (stale) => {
			const { env, raw } = await setup();
			if (stale)
				raw.exec(
					"INSERT INTO memory_vectors VALUES ('m', 'tiny', 'tiny', 3, x'0000803f0000000000000000', 'old-hash', 123, 1)",
				);
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => {
					raw.exec(
						"INSERT INTO memory_vectors VALUES ('m', 'tiny', 'tiny', 3, x'000000000000803f00000000', 'hash-1', 999, 2) ON CONFLICT(memory_id, profile_id) DO UPDATE SET vector = excluded.vector, content_hash = excluded.content_hash, indexed_at = excluded.indexed_at",
					);
					raw.exec("UPDATE memory_vectors SET indexed_at = 999 WHERE memory_id = 'm'");
					return Response.json({ data: [{ embedding: [1, 0, 0] }] });
				}),
			);
			expect(await backfillMemory(env, "m")).toBe(false);
			expect(
				raw.prepare("SELECT hex(vector) AS vector, indexed_at FROM memory_vectors").get(),
			).toMatchObject({ vector: "000000000000803F00000000", indexed_at: 999 });
		},
	);

	it("swallows gateway/storage/config failure and emits static diagnostics only", async () => {
		const { env, raw } = await setup();
		const logger = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error(`gateway raw body ${SECRET}`);
			}),
		);
		expect(await backfillMemory(env, "m")).toBe(false);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1, 0, 0] }] })),
		);
		const prepare = env.DB.prepare.bind(env.DB);
		vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
			if (sql.startsWith("INSERT INTO memory_vectors")) throw new Error(SECRET);
			return prepare(sql);
		});
		expect(await backfillMemory(env, "m")).toBe(false);
		vi.restoreAllMocks();
		vi.spyOn(console, "error").mockImplementation(() => {});
		raw.exec("UPDATE settings SET ciphertext = x'00' WHERE key = 'embedding.api_key'");
		expect(await backfillMemory(env, "m")).toBe(false);
		expect(logger.mock.calls.slice(0, 2)).toEqual([
			[{ event: "embedding_backfill_failed", stage: "request", host: "gateway.example" }],
			[{ event: "embedding_backfill_failed", stage: "config", host: "gateway.example" }],
		]);
		expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_vectors").get()?.n).toBe(0);
	});
});

it("makes no request when enabled without credentials or URL", async () => {
	const { env } = await setup({ ...SETTINGS, api_key: null });
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	expect(await backfillMemory(env, "m")).toBe(false);
	await saveEmbeddingSettings(env, { api_key: SECRET, base_url: null }, "admin:e@local");
	expect(await backfillMemory(env, "m")).toBe(false);
	expect(fetcher).not.toHaveBeenCalled();
});

it.each(["dim = 2", "embedding_model = 'old-model'"])(
	"replaces current-hash but stale profile vectors (%s)",
	async (change) => {
		const { env, raw } = await setup();
		raw.exec(
			"INSERT INTO memory_vectors VALUES ('m', 'tiny', 'tiny', 3, x'0000803f0000000000000000', 'hash-1', 123, 1)",
		);
		raw.exec(`UPDATE memory_vectors SET ${change}`);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [0, 1, 0] }] })),
		);
		expect(await backfillMemory(env, "m")).toBe(true);
	},
);
