import { describe, expect, it } from "vitest";
import { createApp } from "../../index";
import { hmacSecretHash } from "../../search/api-key";

function envWithoutKey() {
	return {
		DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as never,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: async () => new Response() } as never,
		API_KEY_PEPPER: "pepper",
	};
}

describe("v1 search routes", () => {
	it("requires authentication", async () => {
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "x" }),
			},
			envWithoutKey(),
		);
		expect(res.status).toBe(401);
	});

	it("fails when pepper is missing", async () => {
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer octo_abcdefghijkl_secretsecretse",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "x" }),
			},
			{
				DB: envWithoutKey().DB,
				FILES: {} as R2Bucket,
				ASSETS: { fetch: async () => new Response() } as never,
			},
		);
		expect(res.status).toBe(500);
	});

	it("returns batch results for authorized keys", async () => {
		const hash = await hmacSecretHash("pepper", "secretsecretse");
		const env = {
			...envWithoutKey(),
			DB: {
				prepare: (sql: string) => ({
					bind: () => ({
						first: async () => {
							if (sql.includes("api_keys")) {
								return {
									id: "abcdefghijkl",
									secret_hash: hash,
									prev_secret_hash: null,
									prev_valid_until: null,
									scope: "all",
									space_ids_json: "[]",
									revoked_at: null,
									expires_at: null,
									ops: "r",
								};
							}
							return null;
						},
						all: async () => ({ results: [] }),
					}),
					all: async () => ({ results: [] }),
				}),
			} as never,
		};
		const res = await createApp().request(
			"/api/v1/memories:batchGet",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer octo_abcdefghijkl_secretsecretse",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ ids: ["missing"] }),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [], missing: ["missing"] });
	});

	it("runs search for authorized keys", async () => {
		const hash = await hmacSecretHash("pepper", "secretsecretse");
		const env = {
			...envWithoutKey(),
			DB: {
				prepare: (sql: string) => ({
					bind: () => ({
						first: async () => {
							if (sql.includes("api_keys")) {
								return {
									id: "abcdefghijkl",
									secret_hash: hash,
									prev_secret_hash: null,
									prev_valid_until: null,
									scope: "all",
									space_ids_json: "[]",
									revoked_at: null,
									expires_at: null,
									ops: "r",
								};
							}
							return null;
						},
						all: async () => {
							if (sql.includes("FROM spaces")) {
								return { results: [] };
							}
							return { results: [] };
						},
					}),
					all: async () => ({ results: [] }),
				}),
			} as never,
		};
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer octo_abcdefghijkl_secretsecretse",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "cloudflare", mode: "fts", limit: 1 }),
			},
			env,
		);
		expect(res.status).toBe(200);
	});

	it("returns validation errors for malformed search bodies", async () => {
		const hash = await hmacSecretHash("pepper", "secretsecretse");
		const env = {
			...envWithoutKey(),
			DB: {
				prepare: () => ({
					bind: () => ({
						first: async () => ({
							id: "abcdefghijkl",
							secret_hash: hash,
							prev_secret_hash: null,
							prev_valid_until: null,
							scope: "all",
							space_ids_json: "[]",
							revoked_at: null,
							expires_at: null,
							ops: "r",
						}),
					}),
				}),
			} as never,
		};
		const res = await createApp().request(
			"/api/v1/search",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer octo_abcdefghijkl_secretsecretse",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ limit: 1 }),
			},
			env,
		);
		expect(res.status).toBe(400);
	});
});
