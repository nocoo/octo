import type { Context, Next } from "hono";
import { type Env, resourceEnv } from "../env";
import { ApiError } from "../lib/errors";

export const ADMIN_ORIGIN_PROD = "https://octo.hexly.ai";
export const ADMIN_ORIGIN_DEV = "https://octo.dev.hexly.ai";

export function allowedAdminOrigin(env: Env): string {
	return resourceEnv(env.RESOURCE_ENV) === "development" ? ADMIN_ORIGIN_DEV : ADMIN_ORIGIN_PROD;
}

export function isSafeMethod(method: string): boolean {
	const upper = method.toUpperCase();
	return upper === "GET" || upper === "HEAD" || upper === "OPTIONS";
}

export function assertAdminWriteOrigin(request: Request, env: Env): void {
	if (isSafeMethod(request.method)) {
		return;
	}
	if (request.headers.get("Origin") !== allowedAdminOrigin(env)) {
		throw new ApiError("forbidden", "forbidden");
	}
}

export async function adminWriteOriginMiddleware(
	c: Context<{ Bindings: Env }>,
	next: Next,
): Promise<void> {
	assertAdminWriteOrigin(c.req.raw, c.env);
	await next();
}
