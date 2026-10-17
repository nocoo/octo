import { describe, expect, it } from "vitest";
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
						return { results: owned.map((id) => ({ id })) as T[] };
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
