import { Hono } from "hono";
import { APP_VERSION } from "../lib/version";
import { bearerMiddleware } from "./auth/bearer";
import { adminWriteOriginMiddleware } from "./auth/origin";
import type { AppVars, Env } from "./env";
import { jsonError, toErrorResponse } from "./lib/errors";
import { newRequestId, withOctoHeaders } from "./lib/request";
import { accessMiddleware } from "./middleware/access";
import { whoamiResponse } from "./routes/admin/whoami";
import { liveResponse } from "./routes/live";
import { meResponse } from "./routes/v1/me";

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
	app.use("/api/v1/*", bearerMiddleware);
	app.use("/api/admin/*", accessMiddleware);
	app.use("/api/admin/*", adminWriteOriginMiddleware);
	app.get("/api/v1/me", (c) => meResponse(c));
	app.get("/api/admin/whoami", (c) => whoamiResponse(c));
	return app;
}

const app = createApp();

export const worker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
		return app.fetch(request, env, ctx);
	},
};

export default worker;
