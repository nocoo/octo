import { Hono, type MiddlewareHandler } from "hono";
import type { AppVars, Env } from "../../env";
import { idempotencyMiddleware } from "../../http/idempotency";
import { ApiError } from "../../lib/errors";
import {
	attachmentDeleteAuthorization,
	attachmentUploadPreparation,
	createAttachmentsRoutes,
} from "../v1/attachments";
import { createBatchRoutes } from "../v1/batch";
import { changesRoutes } from "../v1/changes";
import { embeddingProfilesRoutes } from "../v1/embedding-profiles";
import { memoriesRoutes } from "../v1/memories";
import { mountV1SearchRoutes } from "../v1/search";
import { tagsRoutes, tagWriteAuthorization } from "../v1/tags";
import { trashRoutes } from "../v1/trash";

const adminPrincipal: MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> = async (
	context,
	next,
) => {
	const email = context.get("adminEmail");
	if (!email) throw new ApiError("unauthenticated", "unauthenticated");
	const actor = `admin:${email}` as const;
	context.set("apiKey", {
		id: actor,
		actor,
		name: email,
		role: "admin",
		ops: new Set(["r", "w", "u", "d"]),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	});
	await next();
};

export function createAdminParityRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const routes = new Hono<{ Bindings: Env; Variables: AppVars }>();
	routes.route("/", createBatchRoutes());
	routes.route("/memories", memoriesRoutes());
	routes.route("/trash", trashRoutes());
	routes.route("/changes", changesRoutes());
	routes.route("/embedding-profiles", embeddingProfilesRoutes());
	routes.route("/tags", tagsRoutes());
	routes.route("/", createAttachmentsRoutes());
	mountV1SearchRoutes(routes, "");
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	const transaction = idempotencyMiddleware("/api/admin");
	for (const route of routes.routes) {
		const preparation: MiddlewareHandler<{ Bindings: Env; Variables: AppVars }>[] = [];
		if (route.method === "POST" && route.path === "/memories/:id/attachments")
			preparation.push(attachmentUploadPreparation);
		if (route.method === "DELETE" && route.path === "/attachments/:id")
			preparation.push(attachmentDeleteAuthorization);
		if (route.method === "POST" && route.path.startsWith("/tags/"))
			preparation.push(tagWriteAuthorization);
		app.on(route.method, route.path, adminPrincipal, ...preparation, transaction, route.handler);
	}
	return app;
}
