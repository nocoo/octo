import { Hono } from "hono";
import { APP_VERSION } from "../lib/version";
import type { AppVars, Env } from "./env";
import { jsonError, toErrorResponse } from "./lib/errors";
import { newRequestId, withOctoHeaders } from "./lib/request";
import { liveResponse } from "./routes/live";

export function createApp(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		const requestId = newRequestId(c.req.raw);
		c.set("requestId", requestId);
		await next();
		c.res = withOctoHeaders(c.res, requestId, APP_VERSION);
	});
	app.onError((err, c) => {
		const requestId = c.get("requestId");
		return withOctoHeaders(toErrorResponse(err, requestId), requestId, APP_VERSION);
	});
	app.notFound((c) => {
		const requestId = c.get("requestId");
		if (c.req.path.startsWith("/api")) {
			return withOctoHeaders(
				jsonError("not_found", "not found", requestId),
				requestId,
				APP_VERSION,
			);
		}
		return c.env.ASSETS.fetch(c.req.raw);
	});
	app.get("/api/live", (c) => liveResponse(c.env));
	return app;
}

const app = createApp();

export const worker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
		return app.fetch(request, env, ctx);
	},
};

export default worker;
