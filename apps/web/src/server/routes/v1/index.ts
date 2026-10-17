import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { createBatchRoutes } from "./batch";

export function createV1Routes(): Hono<{
	Bindings: Env;
	Variables: AppVars;
}> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.route("/", createBatchRoutes());
	return app;
}
