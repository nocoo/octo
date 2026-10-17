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
	"DELETE /api/v1/attachments/:id",
	"DELETE /api/v1/memories/:id",
	"GET /api/admin/whoami",
	"GET /api/live",
	"GET /api/v1/attachments/:id/url",
	"GET /api/v1/changes",
	"GET /api/v1/changes/head",
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
	"GET /files/*",
	"PATCH /api/v1/memories/:id",
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
];
