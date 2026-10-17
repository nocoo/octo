import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { cleanupExternalFiles, purgeMemory } from "../../purge/service";

export function createAdminPurgeRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.delete("/trash/:id", async (context) => {
		const email = context.get("adminEmail");
		if (!email) throw new ApiError("unauthenticated", "unauthenticated");
		const result = await purgeMemory(context.env.DB, context.req.param("id"), `admin:${email}`);
		context.executionCtx.waitUntil(
			cleanupExternalFiles(context.env).catch(() => {
				console.error("purge file cleanup failed");
			}),
		);
		return jsonOk(result);
	});
	return app;
}
