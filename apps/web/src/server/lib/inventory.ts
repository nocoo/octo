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
	"GET /api/admin/whoami",
	"GET /api/live",
	"GET /api/v1/me",
	"GET /api/v1/spaces",
	"GET /api/v1/spaces/:slug",
	"GET /api/v1/tags",
	"POST /api/v1/tags/:name/merge",
	"POST /api/v1/tags/:name/rename",
];
