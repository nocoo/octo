import { Hono } from "hono";
import { bearerMiddleware } from "../../auth/bearer";
import type { AppVars, Env } from "../../env";
import { jsonError, toErrorResponse } from "../../lib/errors";
import { accessMiddleware } from "../../middleware/access";
import { auditMiddleware } from "../middleware";

export const PEPPER = "audit-test-pepper";

export function testEnv(db: D1Database): Env {
	return {
		DB: db,
		FILES: {} as R2Bucket,
		ASSETS: {} as Fetcher,
		API_KEY_PEPPER: PEPPER,
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "admin@example.com",
	};
}

export function testApp() {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", auditMiddleware);
	app.use("*", async (c, next) => {
		c.set("requestId", c.req.header("X-Request-Id") ?? crypto.randomUUID());
		await next();
	});
	app.onError((err, c) => toErrorResponse(err, c.get("requestId")));
	app.notFound((c) => jsonError("not_found", "not found", c.get("requestId")));
	app.use("/api/v1/*", bearerMiddleware);
	app.use("/api/admin/*", accessMiddleware);
	return app;
}

export function execution() {
	const tasks: Promise<unknown>[] = [];
	const ctx = {
		waitUntil(task: Promise<unknown>) {
			tasks.push(task);
		},
		passThroughOnException() {},
		props: {},
	} as ExecutionContext;
	return { ctx, tasks, flush: () => Promise.all(tasks) };
}
