import { describe, expect, it, vi } from "vitest";
import type { ApiKeyRow } from "../../auth/api-key";
import { mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";

type Stored = ApiKeyRow;

function keyDb(owned: string[] = []): { db: D1Database; rows: Map<string, Stored> } {
	const rows = new Map<string, Stored>();
	const db = {
		prepare(sql: string) {
			const stmt = {
				binds: [] as unknown[],
				bind(...args: unknown[]) {
					stmt.binds = args;
					return stmt;
				},
				async first<T>() {
					if (sql.includes("embedding_profiles")) return { id: "p1", model: "m", dims: 2 } as T;
					if (sql.includes("FROM api_keys")) {
						return (rows.get(String(stmt.binds[0])) as T | undefined) ?? null;
					}
					return null;
				},
				async run() {
					if (sql.includes("INSERT INTO api_keys")) {
						const id = String(stmt.binds[0]);
						rows.set(id, {
							id,
							name: String(stmt.binds[1]),
							secret_hash: String(stmt.binds[2]),
							prev_secret_hash: null,
							prev_valid_until: null,
							role: String(stmt.binds[3]),
							ops: String(stmt.binds[4]),
							scope: stmt.binds[5] as Stored["scope"],
							space_ids_json: String(stmt.binds[6]),
							own_entries_only: Number(stmt.binds[7]),
							auto_own_space: Number(stmt.binds[8]),
							expires_at: (stmt.binds[9] as number | null) ?? null,
							revoked_at: null,
							last_used_at: null,
							created_at: Number(stmt.binds[10]),
							updated_at: Number(stmt.binds[11]),
						});
					}
					return { success: true };
				},
				async all<T>() {
					if (sql.includes("FROM spaces")) {
						return { results: owned.map((id) => ({ id, slug: `slug-${id}` })) as T[] };
					}
					return { results: [] as T[] };
				},
			};
			return stmt;
		},
	} as unknown as D1Database;
	return { db, rows };
}

function envFor(db: D1Database, pepper = "pepper"): Env {
	return {
		DB: db,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: pepper,
	};
}

describe("v1 search routes", () => {
	it("requires authentication", async () => {
		const { db } = keyDb();
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "x" }),
			},
			envFor(db),
		);
		expect(res.status).toBe(401);
	});

	it("returns batch results for authorized keys", async () => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const res = await createApp().request(
			"/api/v1/memories:batchGet",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${plaintext}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ ids: ["missing"] }),
			},
			envFor(db),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [], missing: ["missing"] });
	});

	it.each([false, true])(
		"returns 413 for 101 ids before deduplication (duplicates=%s)",
		async (duplicates) => {
			const { db } = keyDb();
			const { plaintext } = await mintApiKey(db, "pepper", {
				name: "bot",
				role: "admin",
				ops: "r",
				scope: "all",
			});
			const ids = Array.from({ length: 101 }, (_, i) => (duplicates ? "same" : `id${i}`));
			const response = await createApp().request(
				"/api/v1/memories:batchGet",
				{
					method: "POST",
					headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
					body: JSON.stringify({ ids }),
				},
				envFor(db),
			);
			expect(response.status).toBe(413);
			expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
		},
	);

	it("accepts exactly 100 ids", async () => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
		const response = await createApp().request(
			"/api/v1/memories:batchGet",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
				body: JSON.stringify({ ids }),
			},
			envFor(db),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ items: [], missing: ids });
	});

	it.each([
		null,
		1,
		{},
		[],
		{ ids: [] },
		{ ids: "invalid" },
		{ ids: [1] },
		{ ids: ["id"], extra: true },
	])("keeps ordinary batch schema errors at 400: %j", async (body) => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const response = await createApp().request(
			"/api/v1/memories:batchGet",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			envFor(db),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
	});

	it("checks authentication and read permission before oversized batch input", async () => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "write-only",
			role: "admin",
			ops: "w",
			scope: "all",
		});
		for (const token of [undefined, plaintext]) {
			const response = await createApp().request(
				"/api/v1/memories:batchGet",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify({ ids: Array<string>(101).fill("id") }),
				},
				envFor(db),
			);
			expect(response.status).toBe(token ? 403 : 401);
		}
	});

	it("runs search for authorized keys", async () => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${plaintext}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "cloudflare", mode: "fts", limit: 1 }),
			},
			envFor(db),
		);
		expect(res.status).toBe(200);
	});

	it("reaches the production Vectorize adapter through bearer auth", async () => {
		const { db } = keyDb(["s1"]);
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const query = vi.fn(async () => ({ matches: [] }));
		const response = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					mode: "vector",
					vector: { profile: "p1", values: [3, 4] },
					filters: { types: ["note"], importance: { min: 0.2, max: 0.8 } },
				}),
			},
			{ ...envFor(db), VEC: { query } as never },
		);
		expect(response.status).toBe(200);
		expect(query).toHaveBeenCalledExactlyOnceWith([0.6, 0.8], {
			topK: 100,
			returnMetadata: "none",
			filter: {
				space: { $in: ["slug-s1"] },
				type: { $in: ["note"] },
				importance: { $gte: 0.2, $lte: 0.8 },
			},
		});
	});

	it("partitions complete production filters under the Vectorize byte limit", async () => {
		const ids = Array.from({ length: 100 }, (_, i) => `project-${i}-knowledge-base`);
		const { db } = keyDb(ids);
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const sources = Array.from({ length: 100 }, (_, i) => `source-${i}-𠮷野-"\\`);
		const types = Array.from({ length: 50 }, (_, i) => `type-${i}-配置-"\\`);
		const query = vi.fn(async (vector: number[], options: VectorizeQueryOptions) => {
			expect(vector).toEqual([0.6, 0.8]);
			expect(options.topK).toBe(100);
			expect(new TextEncoder().encode(JSON.stringify(options.filter)).length).toBeLessThan(2048);
			expect(options.filter).toMatchObject({
				importance: { $gte: 0.2, $lte: 0.8 },
				updated: { $gte: 0, $lte: 1000 },
			});
			return { matches: [] };
		});
		const response = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					mode: "vector",
					vector: { profile: "p1", values: [3, 4] },
					filters: {
						sources,
						types,
						importance: { min: 0.2, max: 0.8 },
						time: { field: "updated", from: "1970-01-01T00:00:00Z", to: "1970-01-01T00:00:01Z" },
					},
				}),
			},
			{ ...envFor(db), VEC: { query } as never },
		);
		expect(response.status).toBe(200);
		expect(query.mock.calls.length).toBeGreaterThan(1);
		expect(query.mock.calls.length).toBeLessThanOrEqual(128);
		const combinations = new Set<string>();
		for (const [, options] of query.mock.calls) {
			const filter = options.filter as Record<string, { $in: string[] }>;
			expect(filter.space?.$in.every((value) => ids.some((id) => value === `slug-${id}`))).toBe(
				true,
			);
			expect(filter.source?.$in.every((value) => sources.includes(value))).toBe(true);
			expect(filter.type?.$in.every((value) => types.includes(value))).toBe(true);
			for (const space of filter.space?.$in ?? []) {
				for (const source of filter.source?.$in ?? []) {
					for (const type of filter.type?.$in ?? []) {
						combinations.add(JSON.stringify([space, source, type]));
					}
				}
			}
		}
		expect(combinations.size).toBe(ids.length * sources.length * types.length);
	});

	it("rejects production Cartesian query amplification before calling Vectorize", async () => {
		const { db } = keyDb(Array.from({ length: 8 }, (_, i) => `${i}`.padEnd(59, "s")));
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const query = vi.fn(async () => ({ matches: [] }));
		const response = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					mode: "vector",
					vector: { profile: "p1", values: [3, 4] },
					filters: {
						sources: Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(900, "k")),
						types: Array.from({ length: 50 }, (_, i) => `${i}`.padEnd(900, "t")),
					},
				}),
			},
			{ ...envFor(db), VEC: { query } as never },
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
		expect(query).not.toHaveBeenCalled();
	});

	it("returns unavailable without querying when a production singleton cannot fit", async () => {
		const { db } = keyDb(["s1"]);
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const query = vi.fn(async () => ({ matches: [] }));
		const response = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					mode: "vector",
					vector: { profile: "p1", values: [3, 4] },
					filters: { sources: ["𠮷".repeat(600)] },
				}),
			},
			{ ...envFor(db), VEC: { query } as never },
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
		expect(query).not.toHaveBeenCalled();
	});

	it.each(["vector", "hybrid"] as const)(
		"does not query Vectorize for an empty visible set in %s mode",
		async (mode) => {
			const { db } = keyDb();
			const { plaintext } = await mintApiKey(db, "pepper", {
				name: "empty",
				role: "project",
				ops: "r",
				scope: "own",
			});
			const query = vi.fn(async () => ({ matches: [] }));
			const body = { mode, query: "cloudflare", vector: { profile: "p1", values: [3, 4] } };
			for (const VEC of [{ query } as unknown as Vectorize, undefined]) {
				const response = await createApp().request(
					"/api/v1/search",
					{
						method: "POST",
						headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
						body: JSON.stringify(body),
					},
					{ ...envFor(db), ...(VEC ? { VEC } : {}) },
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toMatchObject({
					items: [],
					channels: { fts: { candidates: 0 }, vector: { candidates: 0, truncated: false } },
				});
			}
			expect(query).not.toHaveBeenCalled();
			const invalid = await createApp().request(
				"/api/v1/search",
				{
					method: "POST",
					headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
					body: JSON.stringify({ ...body, vector: { profile: "p1", values: [1] } }),
				},
				envFor(db),
			);
			expect(invalid.status).toBe(400);
		},
	);

	it("returns 400 for malformed json bodies", async () => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${plaintext}`,
					"Content-Type": "application/json",
				},
				body: "{",
			},
			envFor(db),
		);
		expect(res.status).toBe(400);
	});

	it("returns validation errors for malformed search bodies", async () => {
		const { db } = keyDb();
		const { plaintext } = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${plaintext}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ limit: 1 }),
			},
			envFor(db),
		);
		expect(res.status).toBe(400);
	});
});
