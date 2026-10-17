import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ORIGIN_DEV, adminWriteOriginMiddleware } from "../../auth/origin";
import type { AppVars, Env } from "../../env";
import { toErrorResponse } from "../../lib/errors";
import { accessMiddleware } from "../../middleware/access";
import { fixture, SECRET, SETTINGS } from "../../settings/__tests__/fixture";
import { settingsRoutes } from "./settings";

function setup() {
	const { env, raw } = fixture();
	env.RESOURCE_ENV = "development";
	env.ACCESS_DEV_BYPASS_EMAIL = "settings@local";
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		c.set("requestId", "settings-test");
		await next();
	});
	app.onError((error, c) => toErrorResponse(error, c.get("requestId")));
	app.use("/api/admin/*", accessMiddleware, adminWriteOriginMiddleware);
	app.route("/api/admin/settings", settingsRoutes());
	const request = (method: string, suffix = "", body?: unknown, origin = ADMIN_ORIGIN_DEV) =>
		app.request(
			`http://localhost/api/admin/settings/embedding${suffix}`,
			{
				method,
				headers: { Origin: origin, "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			env,
		);
	return { env, raw, request, app };
}

afterEach(() => vi.unstubAllGlobals());

describe("admin embedding settings routes", () => {
	it("returns raw JSON, saves with admin actor and never exposes credentials", async () => {
		const { raw, request } = setup();
		const initial = await request("GET");
		expect(initial.status).toBe(200);
		expect(await initial.json()).toMatchObject({ api_key_set: false, backfill_enabled: false });
		const saved = await request("PUT", "", SETTINGS);
		expect(saved.status).toBe(200);
		const text = await saved.text();
		expect(text).not.toContain(SECRET);
		expect(JSON.parse(text)).toMatchObject({ api_key_set: true, api_key_mask: "****ABCD" });
		expect(raw.prepare("SELECT updated_by FROM settings LIMIT 1").get()?.updated_by).toBe(
			"admin:settings@local",
		);
		const read = await request("GET");
		expect(await read.text()).not.toContain(SECRET);
		const cleared = await request("PUT", "", { api_key: null });
		expect(await cleared.json()).toMatchObject({ api_key_set: false });
	});

	it("rejects all three endpoints without Access, and writes without matching origin", async () => {
		const { request, env } = setup();
		for (const [method, path, body] of [
			["PUT", "", SETTINGS],
			["POST", "/test", {}],
		] as const) {
			expect((await request(method, path, body, "https://evil.example")).status).toBe(403);
		}
		delete env.ACCESS_DEV_BYPASS_EMAIL;
		for (const [method, path, body] of [
			["GET", "", undefined],
			["PUT", "", SETTINGS],
			["POST", "/test", {}],
		] as const) {
			expect((await request(method, path, body)).status).toBe(401);
		}
	});

	it("rejects malformed/oversize bodies and profile mismatch safely", async () => {
		const { request, app, env } = setup();
		for (const path of ["/embedding", "/embedding/test"]) {
			const method = path.endsWith("test") ? "POST" : "PUT";
			const invalid = await app.request(
				`http://localhost/api/admin/settings${path}`,
				{ method, headers: { Origin: ADMIN_ORIGIN_DEV }, body: "{" },
				env,
			);
			expect(invalid.status).toBe(400);
			const large = await app.request(
				`http://localhost/api/admin/settings${path}`,
				{ method, headers: { Origin: ADMIN_ORIGIN_DEV }, body: `"${"x".repeat(17_000)}"` },
				env,
			);
			expect(large.status).toBe(413);
		}
		const mismatch = await request("PUT", "", { model: SECRET });
		expect(mismatch.status).toBe(400);
		expect(await mismatch.text()).not.toContain(SECRET);
	});

	it("tests current and unsaved configs with safe errors only", async () => {
		const { request, raw } = setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1, 0, 0] }] })),
		);
		const response = await request("POST", "/test", SETTINGS);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			latency_ms: expect.any(Number),
			dims: 3,
			match: true,
			error_code: null,
		});
		expect(raw.prepare("SELECT COUNT(*) AS n FROM settings").get()?.n).toBe(0);
		await request("PUT", "", SETTINGS);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(SECRET, { status: 403 })),
		);
		const failed = await request("POST", "/test", {});
		expect(failed.status).toBe(200);
		expect(await failed.json()).toMatchObject({ error_code: "embedder_unavailable", match: false });
	});
});
