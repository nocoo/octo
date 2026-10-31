import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BROKEN_PROFILE_AVATAR,
	PROFILE_AVATAR,
	profileTestEnv,
} from "../../../../../../tests/fixtures/author-profiles";
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
	it.each([
		["l3@local", "Zheng Li", PROFILE_AVATAR],
		["architie@gmail.com", "Zheng Li", PROFILE_AVATAR],
		["  Architie@Gmail.com ", "Zheng Li", PROFILE_AVATAR],
		["l3-null@local", null, null],
		["l3-broken@local", "Zheng Li", BROKEN_PROFILE_AVATAR],
	] as const)(
		"shares the real profile flow with fixture identity %s",
		async (email, name, avatar) => {
			const network = vi.fn();
			vi.stubGlobal("fetch", network);
			const app = new Hono<{ Bindings: Env; Variables: AppVars }>().get("/whoami", (context) => {
				context.set("adminEmail", email);
				return whoamiResponse(context);
			});
			const response = await app.request(
				"http://127.0.0.1/whoami",
				{},
				profileTestEnv(env({ RESOURCE_ENV: "test" })),
			);
			expect(await response.json()).toEqual({ email, actor: `admin:${email}`, name, avatar });
			expect(network).not.toHaveBeenCalled();
		},
	);

	it.each([undefined, "production", "development"])(
		"refuses the fixture outside isolated test resources: %s",
		(resource) => {
			expect(() => profileTestEnv(env(resource ? { RESOURCE_ENV: resource } : {}))).toThrow(
				"profile fixture requires isolated test resources",
			);
		},
	);

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
		expect(res.headers.get("Cache-Control")).toBe("no-store");
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

	it("runs test profiles through the injected hash lookup and response validator", async () => {
		const request = vi.fn();
		vi.stubGlobal("fetch", request);
		const profileFetch = vi.fn(async () =>
			Response.json({ name: " Zheng Li ", avatar: "javascript:alert(1)", email: "private" }),
		);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>().get("/whoami", (context) => {
			context.set("adminEmail", "  Architie@Gmail.com ");
			return whoamiResponse(context);
		});
		const response = await app.request(
			"http://127.0.0.1/whoami",
			{},
			env({
				RESOURCE_ENV: "test",
				AUTHOR_PROFILE_FETCHER: { fetch: profileFetch },
			}),
		);
		expect(await response.json()).toEqual({
			email: "  Architie@Gmail.com ",
			actor: "admin:  Architie@Gmail.com ",
			name: "Zheng Li",
			avatar: null,
		});
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(profileFetch).toHaveBeenCalledWith(
			"https://lizheng.blog/api/authors/profile?hash=7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217",
			expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
		);
		expect(request).not.toHaveBeenCalled();
	});

	it("ignores injected profile data outside isolated test resources", async () => {
		const fakeFetch = vi.fn(async () => Response.json({ name: "Fake", avatar: null }));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ name: "Public", avatar: null })),
		);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>().get("/whoami", (context) => {
			context.set("adminEmail", "owner@example.test");
			return whoamiResponse(context);
		});
		const response = await app.request(
			"http://127.0.0.1/whoami",
			{},
			env({
				RESOURCE_ENV: "production",
				AUTHOR_PROFILE_FETCHER: { fetch: fakeFetch },
			}),
		);
		expect(await response.json()).toMatchObject({ name: "Public", avatar: null });
		expect(fakeFetch).not.toHaveBeenCalled();
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
