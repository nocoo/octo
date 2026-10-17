import { describe, expect, it } from "vitest";
import { type ApiKeyRow, mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";

function keyEnv(
	pepper: string,
	spaces: Array<{ id: string; slug: string; name: string }>,
	owned: string[],
): { env: Env; dbRows: Map<string, ApiKeyRow> } {
	const rows = new Map<string, ApiKeyRow>();
	const db = {
		prepare(sql: string) {
			const stmt = {
				binds: [] as unknown[],
				bind(...args: unknown[]) {
					stmt.binds = args;
					return stmt;
				},
				async first<T>() {
					return (rows.get(String(stmt.binds[0])) as T | undefined) ?? null;
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
							scope: stmt.binds[5] as ApiKeyRow["scope"],
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
					if (sql.includes("slug") && sql.includes("IN")) {
						const ids = new Set(stmt.binds.map(String));
						return { results: spaces.filter((space) => ids.has(space.id)) as T[] };
					}
					if (sql.includes("slug")) {
						return { results: spaces as T[] };
					}
					if (sql.includes("owner_key_id")) {
						return { results: owned.map((id) => ({ id })) as T[] };
					}
					return { results: [] as T[] };
				},
			};
			return stmt;
		},
	} as unknown as D1Database;
	return {
		dbRows: rows,
		env: {
			DB: db,
			FILES: {} as R2Bucket,
			ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
			API_KEY_PEPPER: pepper,
		},
	};
}

describe("GET /api/v1/me", () => {
	it("returns the key profile and visible spaces", async () => {
		const { env } = keyEnv(
			"pepper",
			[
				{ id: "s1", slug: "alpha", name: "Alpha" },
				{ id: "s2", slug: "beta", name: "Beta" },
			],
			["s2"],
		);
		const minted = await mintApiKey(env.DB, "pepper", {
			name: "kb-bot",
			role: "admin",
			ops: "r,w,u,d",
			scope: "all",
			expiresAt: Date.UTC(2027, 0, 2),
		});
		const res = await createApp().request(
			"/api/v1/me",
			{ headers: { Authorization: `Bearer ${minted.plaintext}` } },
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			id: minted.row.id,
			name: "kb-bot",
			role: "admin",
			ops: ["d", "r", "u", "w"],
			scope: "all",
			own_entries_only: false,
			auto_own_space: false,
			expires_at: "2027-01-02T00:00:00.000Z",
		});
		const listed = await mintApiKey(env.DB, "pepper", {
			name: "limited",
			role: "custom",
			ops: "r",
			scope: "spaces",
			spaceIds: ["s1"],
		});
		const limited = await createApp().request(
			"/api/v1/me",
			{ headers: { Authorization: `Bearer ${listed.plaintext}` } },
			env,
		);
		expect(await limited.json()).toMatchObject({
			scope: "spaces",
			spaces: [{ id: "s1", slug: "alpha", name: "Alpha" }],
		});
		const empty = await mintApiKey(env.DB, "pepper", {
			name: "none",
			role: "drop",
			ops: "w",
			scope: "spaces",
		});
		const none = await createApp().request(
			"/api/v1/me",
			{ headers: { Authorization: `Bearer ${empty.plaintext}` } },
			env,
		);
		expect(await none.json()).toMatchObject({ spaces: [], expires_at: null });
	});

	it("rejects missing keys with unauthenticated", async () => {
		const { env } = keyEnv("pepper", [], []);
		const res = await createApp().request("/api/v1/me", {}, env);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
	});
});
