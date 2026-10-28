import { Hono } from "hono";
import { APP_VERSION } from "../lib/version";
import { auditMiddleware } from "./audit/middleware";
import { bearerMiddleware } from "./auth/bearer";
import { adminWriteOriginMiddleware } from "./auth/origin";
import type { AppVars, Env } from "./env";
import { runScheduledTasks } from "./http/cron";
import { idempotencyMiddleware } from "./http/idempotency";
import { ApiError, jsonError, toErrorResponse } from "./lib/errors";
import { newRequestId, withOctoHeaders } from "./lib/request";
import { mcpRoutes } from "./mcp";
import { accessMiddleware } from "./middleware/access";
import { adminAuditRoutes } from "./routes/admin/audit";
import { adminDashboardRoutes } from "./routes/admin/dashboard";
import { keysRoutes } from "./routes/admin/keys";
import { createAdminParityRoutes } from "./routes/admin/parity";
import { createAdminPurgeRoutes } from "./routes/admin/purge";
import { settingsRoutes } from "./routes/admin/settings";
import { adminSpacesRoutes } from "./routes/admin/spaces";
import { adminUsageRoutes } from "./routes/admin/usage";
import { whoamiResponse } from "./routes/admin/whoami";
import { createFilesRoutes } from "./routes/files";
import { liveResponse } from "./routes/live";
import { createV1Routes } from "./routes/v1";
import {
	attachmentDeleteAuthorization,
	attachmentUploadPreparation,
	createAttachmentsRoutes,
} from "./routes/v1/attachments";
import { changesRoutes } from "./routes/v1/changes";
import { embeddingProfilesRoutes } from "./routes/v1/embedding-profiles";
import { meResponse } from "./routes/v1/me";
import { memoriesRoutes } from "./routes/v1/memories";
import { moveRoutes } from "./routes/v1/moves";
import { mountV1SearchRoutes } from "./routes/v1/search";
import { spacesRoutes, spaceWriteAuthorization } from "./routes/v1/spaces";
import { tagsRoutes, tagWriteAuthorization } from "./routes/v1/tags";
import { trashRoutes } from "./routes/v1/trash";
import { usageRoutes } from "./routes/v1/usage";
import { postCommitMiddleware } from "./sync/post-commit";
import { runDerivedTasks } from "./sync/tasks";

export function createApp(): Hono<{
	Bindings: Env;
	Variables: AppVars;
}> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		const requestId = newRequestId(c.req.raw);
		c.set("requestId", requestId);
		await next();
		c.res = withOctoHeaders(c.res, requestId, APP_VERSION);
	});
	app.use("*", auditMiddleware);
	app.onError((err, c) => {
		const requestId = c.get("requestId");
		if (!(err instanceof ApiError)) {
			console.error(
				JSON.stringify({
					event: "unhandled_error",
					request_id: requestId,
					method: c.req.method,
					path: c.req.path,
					name: err.name,
					message: err.message,
				}),
			);
		}
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
	app.route("/mcp", mcpRoutes());
	app.use("/api/v1/*", postCommitMiddleware(runDerivedTasks));
	app.use("/api/admin/*", postCommitMiddleware(runDerivedTasks));
	app.use("/api/v1/*", bearerMiddleware);
	app.use("/api/v1/spaces", spaceWriteAuthorization);
	app.use("/api/v1/spaces/:slug", spaceWriteAuthorization);
	app.use("/api/v1/tags/:name", tagWriteAuthorization);
	app.use("/api/v1/tags/:name/rename", tagWriteAuthorization);
	app.use("/api/v1/tags/:name/merge", tagWriteAuthorization);
	app.use("/api/v1/memories/:id/attachments", attachmentUploadPreparation);
	app.use("/api/v1/attachments/:id", attachmentDeleteAuthorization);
	app.use("/api/v1/*", idempotencyMiddleware());
	app.use("/api/admin/*", accessMiddleware);
	app.use("/api/admin/*", adminWriteOriginMiddleware);
	app.get("/api/v1/me", (c) => meResponse(c));
	app.route("/api/v1", createV1Routes());
	app.route("/api/v1", moveRoutes());
	mountV1SearchRoutes(app);
	app.route("/api/v1/memories", memoriesRoutes());
	app.route("/api/v1/trash", trashRoutes());
	app.route("/api/v1/changes", changesRoutes());
	app.get("/api/admin/whoami", (c) => whoamiResponse(c));
	app.route("/api/admin/keys", keysRoutes());
	app.route("/api/admin/spaces", adminSpacesRoutes());
	app.route("/api/admin/audit", adminAuditRoutes());
	app.route("/api/admin/usage", adminUsageRoutes());
	app.route("/api/admin/dashboard", adminDashboardRoutes());
	app.route("/api/admin/settings", settingsRoutes());
	app.route("/api/admin", createAdminPurgeRoutes());
	app.route("/api/admin", createAdminParityRoutes());
	app.route("/api/v1/usage", usageRoutes());
	app.route("/api/v1/embedding-profiles", embeddingProfilesRoutes());
	app.route("/api/v1/tags", tagsRoutes());
	app.route("/api/v1/spaces", spacesRoutes());
	app.route("/api/v1", createAttachmentsRoutes());
	app.route("/", createFilesRoutes());
	return app;
}

const productionApp = createApp();
export const worker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
		return productionApp.fetch(request, env, ctx);
	},
	scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
		ctx.waitUntil(runScheduledTasks(env));
	},
};

export default worker;
