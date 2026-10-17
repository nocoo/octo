import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../../lib/version";
import type { AppVars, Env } from "../../env";
import { ApiError, toErrorResponse } from "../../lib/errors";
import { newRequestId, withOctoHeaders } from "../../lib/request";
import type { MemoryService } from "../../services/memories";
import { testApiPrincipal } from "../../test-principal";
import { createBatchRoutes } from "./batch";

function envWithKey(): Env {
	return {
		DB: {} as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: "pepper",
	};
}

function appWith(service: MemoryService) {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		const requestId = newRequestId(c.req.raw);
		c.set("requestId", requestId);
		await next();
		c.res = withOctoHeaders(c.res, requestId, APP_VERSION);
	});
	app.onError((err, c) => toErrorResponse(err, c.get("requestId")));
	app.use("*", async (c, next) => {
		c.set("apiKey", testApiPrincipal());
		c.set("adminEmail", "");
		await next();
	});
	app.route("/api/v1", createBatchRoutes(service));
	return app;
}

describe("batch routes edge cases", () => {
	it("returns payload_too_large and maps service failures", async () => {
		const service: MemoryService = {
			resolveSpace: async (slug) => `space:${slug}`,
			get: async (id) =>
				id === "m1"
					? {
							id: "m1",
							space: "kb",
							space_id: "space:kb",
							source_key_id: "kid",
							title: "t",
							body: "b",
							type: "note",
							tags: [],
							importance: 0.5,
							version: 1,
							created_at: "t",
							updated_at: "t",
						}
					: null,
			create: async () => {
				throw new ApiError("validation_failed", "bad", { issues: [] });
			},
			update: async () => {
				throw new Error("boom");
			},
			delete: async (id) => {
				if (id === "m2") {
					throw new ApiError("not_found", "missing");
				}
				return { trashed_at: "t" };
			},
		};
		const app = appWith(service);
		const items = Array.from({ length: 101 }, () => ({
			space: "kb",
			title: "x",
			body: "b",
			type: "note",
			tags: [],
		}));
		const tooLarge = await app.request(
			"/api/v1/memories:batchCreate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ items }),
			},
			envWithKey(),
		);
		expect(tooLarge.status).toBe(413);
		const created = await app.request(
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
		const createdBody = (await created.json()) as {
			results: Array<{ ok: boolean; error?: { code: string; details?: Record<string, unknown> } }>;
		};
		expect(createdBody.results[0]?.ok).toBe(false);
		expect(createdBody.results[0]?.error?.code).toBe("validation_failed");
		expect(createdBody.results[0]?.error?.details).toEqual({ issues: [] });
		const updated = await app.request(
			"/api/v1/memories:batchUpdate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: [{ id: "m1", title: "y", expected_version: 1 }],
				}),
			},
			envWithKey(),
		);
		const updatedBody = (await updated.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(updatedBody.results[0]?.error?.code).toBe("internal");
		const deleted = await app.request(
			"/api/v1/memories:batchDelete",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: ["m1", "m2"] }),
			},
			envWithKey(),
		);
		expect(deleted.status).toBe(200);
		const deletedBody = (await deleted.json()) as { results: unknown[] };
		expect(deletedBody.results).toHaveLength(2);
		const tooManyIds = Array.from({ length: 101 }, (_, i) => `id-${i}`);
		const tooManyUpdate = await app.request(
			"/api/v1/memories:batchUpdate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: tooManyIds.map((id) => ({ id, title: "t", expected_version: 1 })),
				}),
			},
			envWithKey(),
		);
		expect(tooManyUpdate.status).toBe(413);
		const tooManyDelete = await app.request(
			"/api/v1/memories:batchDelete",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: tooManyIds }),
			},
			envWithKey(),
		);
		expect(tooManyDelete.status).toBe(413);
	});
});
