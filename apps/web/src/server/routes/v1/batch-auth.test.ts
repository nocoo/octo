import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiPrincipal } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { StubMemoryService } from "../../services/stub-memories";
import { createBatchRoutes } from "./batch";

function dbWithKbSpace(): D1Database {
	return {
		prepare: (sql: string) => {
			if (sql.includes("FROM spaces")) {
				return {
					bind: (slug: string) => ({
						first: async () => (slug === "kb" ? { id: "sp-kb" } : null),
					}),
				};
			}
			return {
				bind: () => ({
					first: async () => null,
					run: async () => ({ success: true, meta: { changes: 0 } }),
				}),
			};
		},
	} as unknown as D1Database;
}

function envWithKey(): Env {
	return {
		DB: dbWithKbSpace(),
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: "pepper",
	};
}

function readonlyPrincipal(): ApiPrincipal {
	return {
		id: "ro",
		name: "read-only",
		role: "readonly",
		ops: new Set(["r"]),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	};
}

describe("batch route authorization", () => {
	it("returns per-item forbidden for read-only batch updates", async () => {
		const svc = new StubMemoryService();
		const created = await svc.create(
			{ space: "kb", title: "t", body: "b", type: "note", tags: [] },
			{ keyId: "w", actor: "key:w", spaceId: "sp-kb" },
		);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", async (c, next) => {
			c.set("apiKey", readonlyPrincipal());
			c.set("adminEmail", "");
			await next();
		});
		app.route("/api/v1", createBatchRoutes(svc));
		const res = await app.request(
			"/api/v1/memories:batchUpdate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ id: created.id, title: "nope", expected_version: created.version }],
				}),
			},
			envWithKey(),
		);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(body.results[0]?.error?.code).toBe("forbidden");
	});

	it("returns per-item forbidden for read-only keys", async () => {
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", async (c, next) => {
			c.set("apiKey", readonlyPrincipal());
			c.set("adminEmail", "");
			await next();
		});
		app.route("/api/v1", createBatchRoutes(new StubMemoryService()));
		const res = await app.request(
			"/api/v1/memories:batchCreate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ space: "kb", title: "x", body: "b", type: "note", tags: [] }],
				}),
			},
			envWithKey(),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(body.results[0]?.ok).toBe(false);
		expect(body.results[0]?.error?.code).toBe("forbidden");
	});

	it("rejects cross-space moves without visibility", async () => {
		const svc = new StubMemoryService();
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		const principal: ApiPrincipal = {
			id: "sp",
			name: "space-only",
			role: "drop",
			ops: new Set(["r", "w", "u", "d"]),
			scope: "spaces",
			spaceIds: ["sp-kb"],
			ownedSpaceIds: [],
			ownEntriesOnly: false,
			autoOwnSpace: false,
			expiresAt: null,
		};
		app.use("*", async (c, next) => {
			c.set("apiKey", principal);
			c.set("adminEmail", "");
			await next();
		});
		app.route("/api/v1", createBatchRoutes(svc));
		const ctx = { keyId: "sp", actor: "key:sp", spaceId: "sp-kb" };
		const created = await svc.create(
			{ space: "kb", title: "t", body: "b", type: "note", tags: [] },
			ctx,
		);
		const res = await app.request(
			"/api/v1/memories:batchUpdate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ id: created.id, space: "other", expected_version: created.version }],
				}),
			},
			envWithKey(),
		);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(body.results[0]?.ok).toBe(false);
		expect(body.results[0]?.error?.code).toBe("not_found");
	});

	it("allows moves when both spaces are visible", async () => {
		const svc = new StubMemoryService();
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		const principal: ApiPrincipal = {
			id: "sp",
			name: "space-only",
			role: "drop",
			ops: new Set(["r", "w", "u", "d"]),
			scope: "spaces",
			spaceIds: ["sp-kb", "sp-other"],
			ownedSpaceIds: [],
			ownEntriesOnly: false,
			autoOwnSpace: false,
			expiresAt: null,
		};
		app.use("*", async (c, next) => {
			c.set("apiKey", principal);
			c.set("adminEmail", "");
			await next();
		});
		app.route("/api/v1", createBatchRoutes(svc));
		const created = await svc.create(
			{ space: "kb", title: "t", body: "b", type: "note", tags: [] },
			{ keyId: "sp", actor: "key:sp", spaceId: "sp-kb" },
		);
		const env: Env = {
			...envWithKey(),
			DB: {
				prepare: (sql: string) => {
					if (sql.includes("FROM spaces")) {
						return {
							bind: (slug: string) => ({
								first: async () =>
									slug === "kb" ? { id: "sp-kb" } : slug === "other" ? { id: "sp-other" } : null,
							}),
						};
					}
					return envWithKey().DB.prepare(sql);
				},
			} as unknown as D1Database,
		};
		const res = await app.request(
			"/api/v1/memories:batchUpdate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ id: created.id, space: "other", expected_version: created.version }],
				}),
			},
			env,
		);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; item?: { space: string } }>;
		};
		expect(body.results[0]?.ok).toBe(true);
		expect(body.results[0]?.item?.space).toBe("other");
	});

	it("blocks ownEntriesOnly keys from moving foreign rows", async () => {
		const svc = new StubMemoryService();
		const created = await svc.create(
			{ space: "kb", title: "t", body: "b", type: "note", tags: [] },
			{ keyId: "owner", actor: "key:owner", spaceId: "sp-kb" },
		);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		const principal: ApiPrincipal = {
			id: "me",
			name: "own-only",
			role: "project",
			ops: new Set(["r", "w", "u", "d"]),
			scope: "all",
			spaceIds: [],
			ownedSpaceIds: [],
			ownEntriesOnly: true,
			autoOwnSpace: false,
			expiresAt: null,
		};
		app.use("*", async (c, next) => {
			c.set("apiKey", principal);
			c.set("adminEmail", "");
			await next();
		});
		app.route("/api/v1", createBatchRoutes(svc));
		const env: Env = {
			...envWithKey(),
			DB: {
				prepare: (sql: string) => {
					if (sql.includes("FROM spaces")) {
						return {
							bind: (slug: string) => ({
								first: async () =>
									slug === "kb" ? { id: "sp-kb" } : slug === "other" ? { id: "sp-other" } : null,
							}),
						};
					}
					return envWithKey().DB.prepare(sql);
				},
			} as unknown as D1Database,
		};
		const res = await app.request(
			"/api/v1/memories:batchUpdate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ id: created.id, space: "other", expected_version: created.version }],
				}),
			},
			env,
		);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(body.results[0]?.error?.code).toBe("forbidden");
	});

	it("blocks ownEntriesOnly keys from deleting foreign rows", async () => {
		const svc = new StubMemoryService();
		const created = await svc.create(
			{ space: "kb", title: "t", body: "b", type: "note", tags: [] },
			{ keyId: "owner", actor: "key:owner", spaceId: "sp-kb" },
		);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		const principal: ApiPrincipal = {
			id: "me",
			name: "own-only",
			role: "project",
			ops: new Set(["r", "w", "u", "d"]),
			scope: "all",
			spaceIds: [],
			ownedSpaceIds: [],
			ownEntriesOnly: true,
			autoOwnSpace: false,
			expiresAt: null,
		};
		app.use("*", async (c, next) => {
			c.set("apiKey", principal);
			c.set("adminEmail", "");
			await next();
		});
		app.route("/api/v1", createBatchRoutes(svc));
		const res = await app.request(
			"/api/v1/memories:batchDelete",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [created.id] }),
			},
			envWithKey(),
		);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(body.results[0]?.error?.code).toBe("forbidden");
	});
});
