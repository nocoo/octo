import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppVars, Env } from "../../env";
import { StubMemoryService } from "../../services/stub-memories";
import { testApiPrincipal } from "../../test-principal";
import { createBatchRoutes } from "./batch";

function envWithKey(): Env {
	return {
		DB: {
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
		} as unknown as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: "pepper",
	};
}

describe("batch routes", () => {
	it("batch creates memories per item", async () => {
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", async (c, next) => {
			c.set("apiKey", testApiPrincipal());
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
					items: [
						{
							space: "kb",
							title: "one",
							body: "b",
							type: "note",
							tags: [],
						},
					],
				}),
			},
			envWithKey(),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { results: Array<{ ok: boolean }> };
		expect(body.results[0]?.ok).toBe(true);
	});
});
