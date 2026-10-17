import { Hono } from "hono";
import { queryAudit } from "../../audit/log-query";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export function adminAuditRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.get("/", async (context) => jsonOk(await queryAudit(context.env, context.req.queries())));
	return app;
}
