import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { adminWriteOriginMiddleware } from "../../auth/origin";
import type { AppVars, Env } from "../../env";
import { toErrorResponse } from "../../lib/errors";
import { accessMiddleware } from "../../middleware/access";
import { createAdminPurgeRoutes } from "./purge";

describe("admin purge route", () => {
	it("requires Access and same origin before purging, then schedules post-commit cleanup", async () => {
		const { db, sqlite } = sqliteD1();
		sqlite.exec(`INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at)
			VALUES ('purge-me', 'space:kb', 'title', 'body', 'note', 'key', 'hash', 1, 1, 2)`);
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.onError((error) => toErrorResponse(error, "purge-test"));
		app.use("/api/admin/*", accessMiddleware, adminWriteOriginMiddleware);
		app.route("/api/admin", createAdminPurgeRoutes());
		const files = { delete: vi.fn() };
		const env = {
			DB: db,
			FILES: files,
			RESOURCE_ENV: "development",
			ACCESS_DEV_BYPASS_EMAIL: "owner@local",
		} as unknown as Env;
		const pending: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
		} as unknown as ExecutionContext;
		const request = (origin: string, currentEnv = env) =>
			app.request(
				"http://localhost/api/admin/trash/purge-me",
				{ method: "DELETE", headers: { Origin: origin } },
				currentEnv,
				ctx,
			);
		expect(
			(await request("https://octo.dev.hexly.ai", { ...env, ACCESS_DEV_BYPASS_EMAIL: "" })).status,
		).toBe(401);
		expect((await request("https://evil.example")).status).toBe(403);
		expect(pending).toEqual([]);
		const response = await request("https://octo.dev.hexly.ai");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: "purge-me", purged: true });
		expect(pending).toHaveLength(1);
		await Promise.all(pending);
		expect((await request("https://octo.dev.hexly.ai")).status).toBe(404);
	});

	it("fails closed without a parent identity and logs cleanup lookup failure statically", async () => {
		const { db, sqlite } = sqliteD1();
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.onError((error) => toErrorResponse(error, "purge-test"));
		app.use("*", async (context, next) => {
			if (context.req.header("X-Identity")) context.set("adminEmail", "owner@local");
			await next();
		});
		app.route("/api/admin", createAdminPurgeRoutes());
		const env = { DB: db, FILES: { delete: vi.fn() } } as unknown as Env;
		expect((await app.request("/api/admin/trash/missing", { method: "DELETE" }, env)).status).toBe(
			401,
		);
		sqlite.exec(`INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at)
			VALUES ('purge-me', 'space:kb', 'title', 'body', 'note', 'key', 'hash', 1, 1, 2)`);
		const prepare = db.prepare.bind(db);
		vi.spyOn(db, "prepare").mockImplementation((sql) => {
			if (sql.startsWith("SELECT r2_key")) throw new Error("private cleanup lookup");
			return prepare(sql);
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const pending: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
		} as unknown as ExecutionContext;
		expect(
			(
				await app.request(
					"/api/admin/trash/purge-me",
					{ method: "DELETE", headers: { "X-Identity": "test" } },
					env,
					ctx,
				)
			).status,
		).toBe(200);
		await Promise.all(pending);
		expect(log.mock.calls).toEqual([["purge file cleanup failed"]]);
	});
});
