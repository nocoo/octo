import type { Hono } from "hono";
import type { AppVars, Env } from "../env";

export type RouteKey = `${string} ${string}`;

export function routeKey(method: string, path: string): RouteKey {
	return `${method.toUpperCase()} ${path}` as RouteKey;
}

export function listedRoutes(app: Hono<{ Bindings: Env; Variables: AppVars }>): RouteKey[] {
	const keys = new Set<RouteKey>();
	for (const route of app.routes) {
		if (route.method === "ALL") {
			continue;
		}
		keys.add(routeKey(route.method, route.path));
	}
	return [...keys].sort();
}

export const TESTED_API_ROUTES: RouteKey[] = [
	"DELETE /api/admin/attachments/:id",
	"DELETE /api/admin/keys/:id",
	"DELETE /api/admin/memories/:id",
	"DELETE /api/admin/spaces/:slug",
	"DELETE /api/admin/trash/:id",
	"DELETE /api/v1/attachments/:id",
	"DELETE /api/v1/memories/:id",
	"DELETE /mcp",
	"GET /api/admin/attachments/:id/url",
	"GET /api/admin/audit",
	"GET /api/admin/changes",
	"GET /api/admin/changes/head",
	"GET /api/admin/embedding-profiles",
	"GET /api/admin/keys",
	"GET /api/admin/keys/:id",
	"GET /api/admin/memories",
	"GET /api/admin/memories/:id",
	"GET /api/admin/memories/:id/attachments",
	"GET /api/admin/memories/:id/diff",
	"GET /api/admin/memories/:id/versions",
	"GET /api/admin/memories/:id/versions/:v",
	"GET /api/admin/settings/embedding",
	"GET /api/admin/spaces",
	"GET /api/admin/spaces/:slug",
	"GET /api/admin/tags",
	"GET /api/admin/trash",
	"GET /api/admin/usage",
	"GET /api/admin/whoami",
	"GET /api/live",
	"GET /api/v1/attachments/:id/url",
	"GET /api/v1/changes",
	"GET /api/v1/changes/head",
	"GET /api/v1/embedding-profiles",
	"GET /api/v1/me",
	"GET /api/v1/memories",
	"GET /api/v1/memories/:id",
	"GET /api/v1/memories/:id/attachments",
	"GET /api/v1/memories/:id/diff",
	"GET /api/v1/memories/:id/versions",
	"GET /api/v1/memories/:id/versions/:v",
	"GET /api/v1/spaces",
	"GET /api/v1/spaces/:slug",
	"GET /api/v1/tags",
	"GET /api/v1/trash",
	"GET /api/v1/usage",
	"GET /files/*",
	"GET /mcp",
	"PATCH /api/admin/keys/:id",
	"PATCH /api/admin/memories/:id",
	"PATCH /api/admin/spaces/:slug",
	"PATCH /api/v1/memories/:id",
	"POST /api/admin/keys",
	"POST /api/admin/keys/:id/revoke",
	"POST /api/admin/keys/:id/rotate",
	"POST /api/admin/memories",
	"POST /api/admin/memories/:id/attachments",
	"POST /api/admin/memories/:id/rollback",
	"POST /api/admin/memories:batchCreate",
	"POST /api/admin/memories:batchDelete",
	"POST /api/admin/memories:batchGet",
	"POST /api/admin/memories:batchUpdate",
	"POST /api/admin/search",
	"POST /api/admin/settings/embedding/test",
	"POST /api/admin/spaces",
	"POST /api/admin/tags/:name/merge",
	"POST /api/admin/tags/:name/rename",
	"POST /api/admin/trash/:id/restore",
	"POST /api/v1/memories",
	"POST /api/v1/memories/:id/attachments",
	"POST /api/v1/memories/:id/rollback",
	"POST /api/v1/memories:batchCreate",
	"POST /api/v1/memories:batchDelete",
	"POST /api/v1/memories:batchGet",
	"POST /api/v1/memories:batchUpdate",
	"POST /api/v1/search",
	"POST /api/v1/tags/:name/merge",
	"POST /api/v1/tags/:name/rename",
	"POST /api/v1/trash/:id/restore",
	"POST /mcp",
	"PUT /api/admin/memories/:id/vector",
	"PUT /api/admin/settings/embedding",
	"PUT /api/v1/memories/:id/vector",
];
