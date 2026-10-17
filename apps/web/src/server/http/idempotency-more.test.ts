import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../lib/version";
import type { AppVars, Env } from "../env";
import { ApiError, toErrorResponse } from "../lib/errors";
import { newRequestId, withOctoHeaders } from "../lib/request";
import { testApiPrincipal } from "../test-principal";
import { idempotencyMiddleware } from "./idempotency";
import type { IdempotencyRecord } from "./idempotency-repo";
import * as idempotencyRepo from "./idempotency-repo";

function mockEnv(_records: Map<string, IdempotencyRecord>): Env {
	return {
		DB: {
			prepare: () => ({
				bind: () => ({
					run: async () => ({ success: true, meta: { changes: 1 } }),
					first: async () => null,
				}),
			}),
		} as unknown as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: "pepper",
	};
}

function testApp() {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		const requestId = newRequestId(c.req.raw);
		c.set("requestId", requestId);
		c.set("apiKey", testApiPrincipal());
		c.set("adminEmail", "");
		await next();
		c.res = withOctoHeaders(c.res, requestId, APP_VERSION);
	});
	app.onError((err, c) => toErrorResponse(err, c.get("requestId")));
	app.use("*", idempotencyMiddleware());
	app.post("/api/v1/echo", (c) => c.json({ ok: true }, 201));
	return app;
}

describe("idempotencyMiddleware edge cases", () => {
	it("replays after waiting on an in-flight claim", async () => {
		vi.spyOn(idempotencyRepo, "claimIdempotencyKey").mockResolvedValueOnce({ kind: "in_progress" });
		vi.spyOn(idempotencyRepo, "waitForIdempotencyReplay").mockResolvedValueOnce({
			kind: "replay",
			status: 201,
			body: '{"waited":true}',
		});
		const app = testApp();
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Idempotency-Key": "wait", "Content-Type": "application/json" },
				body: "{}",
			},
			mockEnv(new Map()),
		);
		expect(res.status).toBe(201);
		expect(res.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await res.text()).toBe('{"waited":true}');
		vi.restoreAllMocks();
	});

	it("does not release the claim when persistence fails after the handler succeeds", async () => {
		vi.spyOn(idempotencyRepo, "claimIdempotencyKey").mockResolvedValueOnce({ kind: "claimed" });
		const release = vi.spyOn(idempotencyRepo, "releaseIdempotencyClaim").mockResolvedValue();
		vi.spyOn(idempotencyRepo, "completeIdempotencyRecord").mockRejectedValueOnce(new Error("d1"));
		const app = testApp();
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Idempotency-Key": "store", "Content-Type": "application/json" },
				body: "{}",
			},
			mockEnv(new Map()),
		);
		expect(res.status).toBe(500);
		expect(release).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("returns unavailable when a matching request is still in flight", async () => {
		vi.spyOn(idempotencyRepo, "claimIdempotencyKey").mockResolvedValueOnce({ kind: "in_progress" });
		vi.spyOn(idempotencyRepo, "waitForIdempotencyReplay").mockResolvedValueOnce({
			kind: "in_progress",
		});
		const app = testApp();
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Idempotency-Key": "pending", "Content-Type": "application/json" },
				body: "{}",
			},
			mockEnv(new Map()),
		);
		expect(res.status).toBe(503);
		vi.restoreAllMocks();
	});

	it("rethrows ApiError failures from storage", async () => {
		vi.spyOn(idempotencyRepo, "claimIdempotencyKey").mockResolvedValueOnce({ kind: "claimed" });
		vi.spyOn(idempotencyRepo, "completeIdempotencyRecord").mockRejectedValueOnce(
			new ApiError("internal", "corrupt idempotency row"),
		);
		const app = testApp();
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Idempotency-Key": "api-err", "Content-Type": "application/json" },
				body: "{}",
			},
			mockEnv(new Map()),
		);
		expect(res.status).toBe(500);
		vi.restoreAllMocks();
	});

	it("releases the claim when downstream middleware throws", async () => {
		vi.spyOn(idempotencyRepo, "claimIdempotencyKey").mockResolvedValueOnce({ kind: "claimed" });
		const release = vi.spyOn(idempotencyRepo, "releaseIdempotencyClaim").mockResolvedValue();
		const mw = idempotencyMiddleware();
		const env = mockEnv(new Map());
		const req = new Request("http://localhost/api/v1/echo", {
			method: "POST",
			headers: { "Idempotency-Key": "boom", "Content-Type": "application/json" },
			body: "{}",
		});
		const res = new Response();
		const c = {
			req: {
				method: "POST",
				path: "/api/v1/echo",
				header: (n: string) => req.headers.get(n),
				raw: req,
			},
			env,
			get: (key: string) => (key === "apiKey" ? testApiPrincipal() : undefined),
			res,
		};
		await expect(
			mw(c as never, async () => {
				throw new Error("handler failed");
			}),
		).rejects.toThrow("handler failed");
		expect(release).toHaveBeenCalledOnce();
		vi.restoreAllMocks();
	});

	it("maps non-ApiError store failures to internal errors", async () => {
		vi.spyOn(idempotencyRepo, "claimIdempotencyKey").mockResolvedValueOnce({ kind: "claimed" });
		vi.spyOn(idempotencyRepo, "completeIdempotencyRecord").mockRejectedValueOnce(new Error("d1"));
		const app = testApp();
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Idempotency-Key": "store2", "Content-Type": "application/json" },
				body: "{}",
			},
			mockEnv(new Map()),
		);
		expect(res.status).toBe(500);
		vi.restoreAllMocks();
	});
});
