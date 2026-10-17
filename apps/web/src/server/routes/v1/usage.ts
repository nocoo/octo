import { Hono } from "hono";
import { queryUsage } from "../../audit/usage-query";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export function usageRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.get("/", async (context) =>
		jsonOk(await queryUsage(context.env, context.req.queries(), context.get("apiKey").id)),
	);
	return app;
}
