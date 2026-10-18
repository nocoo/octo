import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ORIGIN_DEV, ADMIN_ORIGIN_PROD } from "../../auth/origin";
import type { AppVars, Env } from "../../env";
import { createApp } from "../../index";
import { whoamiResponse } from "./whoami";

function env(partial: Partial<Env> = {}): Env {
	return {
		DB: {} as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		...partial,
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/admin/whoami", () => {
	it("returns the Access actor when development bypass is set", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ name: "Li Zheng", avatar: "https://lizheng.blog/avatar.png" }),
				),
		);
		const res = await createApp().request(
			"http://127.0.0.1/api/admin/whoami",
			{},
			env({ RESOURCE_ENV: "development", ACCESS_DEV_BYPASS_EMAIL: "zheng@hexly.ai" }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			email: "zheng@hexly.ai",
			actor: "admin:zheng@hexly.ai",
			name: "Li Zheng",
			avatar: "https://lizheng.blog/avatar.png",
		});
	});

	it("keeps isolated test resources independent of the external profile service", async () => {
		const request = vi.fn();
		vi.stubGlobal("fetch", request);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>().get("/whoami", (c) => {
			c.set("adminEmail", "l3@local");
			return whoamiResponse(c);
		});
		const res = await app.request("http://127.0.0.1/whoami", {}, env({ RESOURCE_ENV: "test" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			email: "l3@local",
			actor: "admin:l3@local",
			name: null,
			avatar: null,
		});
		expect(request).not.toHaveBeenCalled();
	});

	it("rejects cross-origin admin writes", async () => {
		const bypass = env({
			RESOURCE_ENV: "development",
			ACCESS_DEV_BYPASS_EMAIL: "zheng@hexly.ai",
		});
		const denied = await createApp().request(
			"http://127.0.0.1/api/admin/whoami",
			{ method: "POST", headers: { Origin: "https://evil.example" } },
			bypass,
		);
		expect(denied.status).toBe(403);
		const allowed = await createApp().request(
			"http://127.0.0.1/api/admin/whoami",
			{ method: "POST", headers: { Origin: ADMIN_ORIGIN_DEV } },
			bypass,
		);
		expect(allowed.status).toBe(404);
		const prod = await createApp().request(
			"http://127.0.0.1/api/admin/whoami",
			{ method: "POST", headers: { Origin: ADMIN_ORIGIN_PROD } },
			env({ RESOURCE_ENV: "development", ACCESS_DEV_BYPASS_EMAIL: "zheng@hexly.ai" }),
		);
		expect(prod.status).toBe(403);
	});
});
