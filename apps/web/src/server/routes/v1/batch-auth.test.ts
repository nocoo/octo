import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiPrincipal } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { StubMemoryService } from "../../services/stub-memories";
import { createBatchRoutes } from "./batch";

function envWithKey(): Env {
	return {
		DB: {} as D1Database,
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
			spaceIds: ["kb"],
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
		const ctx = { keyId: "sp", actor: "key:sp" };
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
});
