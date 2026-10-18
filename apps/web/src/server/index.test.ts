import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../tests/fixtures/sqlite-d1";
import { APP_VERSION } from "../lib/version";
import type { Env } from "./env";
import { createApp, worker } from "./index";
import { ApiError } from "./lib/errors";

function env(connected = true): Env {
	const stmt = {
		bind: () => stmt,
		first: async () => (connected ? { n: 1, value: "test" } : { n: 0 }),
		run: async () => ({ success: true }),
	};
	return {
		DB: { prepare: () => stmt } as unknown as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
	};
}

describe("createApp", () => {
	afterEach(() => vi.restoreAllMocks());

	it("serves live with version headers", async () => {
		const res = await createApp().request("/api/live", {}, env());
		expect(res.status).toBe(200);
		expect(res.headers.get("X-Octo-Version")).toBe(APP_VERSION);
		expect(res.headers.get("X-Request-Id")).toBeTruthy();
		expect(await res.json()).toMatchObject({ name: "octo", database: { connected: true } });
	});

	it("reuses X-Request-Id and returns the error envelope", async () => {
		const res = await createApp().request(
			"/api/missing",
			{ headers: { "X-Request-Id": "fixed" } },
			env(),
		);
		expect(res.status).toBe(404);
		expect(res.headers.get("X-Request-Id")).toBe("fixed");
		expect(await res.json()).toEqual({
			error: { code: "not_found", message: "not found", request_id: "fixed" },
		});
	});

	it("falls back to ASSETS for non-api paths", async () => {
		const res = await createApp().request("/", {}, env());
		expect(await res.text()).toBe("spa");
	});

	it("mounts batch reads and real writes in the production app", () => {
		const paths = createApp()
			.routes.filter((route) => route.path.startsWith("/api/v1/") && route.path.includes("batch"))
			.map((route) => route.path);
		expect(paths).toEqual([
			"/api/v1/memories:batchCreate",
			"/api/v1/memories:batchUpdate",
			"/api/v1/memories:batchDelete",
			"/api/v1/memories:batchGet",
		]);
	});

	it("maps thrown ApiError through onError", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = createApp();
		app.get("/api/boom", () => {
			throw new ApiError("unauthenticated", "no key");
		});
		const res = await app.request("/api/boom", {}, env());
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({
			error: { code: "unauthenticated", message: "no key" },
		});
		expect(log).not.toHaveBeenCalled();
	});

	it("does not log known internal ApiErrors as unhandled", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = createApp();
		app.get("/api/boom", () => {
			throw new ApiError("internal", "known failure");
		});
		const res = await app.request("/api/boom", {}, env());
		expect(res.status).toBe(500);
		expect(log).not.toHaveBeenCalled();
	});

	it.each([
		new Error("vector query failed"),
		new TypeError("vector query failed\ninvalid options"),
	])("logs one structured line for an unknown $name without request secrets", async (error) => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = createApp();
		app.post("/api/boom", () => {
			throw error;
		});
		const res = await app.request(
			"/api/boom?api_key=query-secret&token=other-secret",
			{
				method: "POST",
				headers: {
					"X-Request-Id": "fixed",
					Authorization: "Bearer header-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ secret: "body-secret" }),
			},
			env(),
		);
		expect(res.status).toBe(500);
		expect(res.headers.get("X-Request-Id")).toBe("fixed");
		expect(res.headers.get("X-Octo-Version")).toBe(APP_VERSION);
		expect(await res.json()).toEqual({
			error: { code: "internal", message: "internal error", request_id: "fixed" },
		});
		expect(log.mock.calls).toEqual([
			[
				JSON.stringify({
					event: "unhandled_error",
					request_id: "fixed",
					method: "POST",
					path: "/api/boom",
					name: error.name,
					message: error.message,
				}),
			],
		]);
	});

	it("correlates an unknown error with the generated request id", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = createApp();
		app.get("/api/boom", () => {
			throw new Error("unexpected");
		});
		const res = await app.request("/api/boom", {}, env());
		const requestId = res.headers.get("X-Request-Id");
		expect(requestId).toBeTruthy();
		expect(await res.json()).toEqual({
			error: { code: "internal", message: "internal error", request_id: requestId },
		});
		expect(log.mock.calls).toEqual([
			[
				JSON.stringify({
					event: "unhandled_error",
					request_id: requestId,
					method: "GET",
					path: "/api/boom",
					name: "Error",
					message: "unexpected",
				}),
			],
		]);
	});
});

describe("worker", () => {
	it("refuses v1 keys outside the test injector", async () => {
		const res = await createApp().request(
			"/api/v1/tags",
			{ headers: { Authorization: "Bearer octo_abcdefghijkl_secret" } },
			env(),
		);
		expect(res.status).toBe(401);
	});

	it("delegates fetch to the app", async () => {
		const res = await worker.fetch(
			new Request("http://octo.local/api/live"),
			env(),
			{} as ExecutionContext,
		);
		expect(res.status).toBe(200);
	});

	it("schedules idempotency, usage and derived tasks", async () => {
		const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
		const { db } = sqliteD1();
		const scheduledEnv = {
			...env(),
			DB: db,
			RESOURCE_ENV: "test",
		};
		worker.scheduled({} as ScheduledEvent, scheduledEnv, {
			waitUntil,
		} as unknown as ExecutionContext);
		expect(waitUntil).toHaveBeenCalled();
		await waitUntil.mock.calls[0]?.[0];
	});
});
