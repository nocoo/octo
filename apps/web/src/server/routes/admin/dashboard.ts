import { Hono } from "hono";
import { queryDashboard } from "../../dashboard/query";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export function adminDashboardRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.get("/", async (context) =>
		jsonOk(await queryDashboard(context.env, context.req.queries()), 200, {
			"Cache-Control": "no-store",
		}),
	);
	return app;
}
