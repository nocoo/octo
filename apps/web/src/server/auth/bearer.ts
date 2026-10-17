import type { Context, Next } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { type ApiKeyRow, lookupApiKey, touchLastUsed } from "./api-key";
import { type ApiPrincipal, parseOps } from "./authorize";

export function extractBearer(header: string | null): string | null {
	if (!header) {
		return null;
	}
	const parts = header.split(" ");
	if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
		return null;
	}
	return parts[1];
}

export function parseSpaceIds(json: string): string[] {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
			return [];
		}
		return parsed;
	} catch {
		return [];
	}
}

export async function hydrateApiKey(db: D1Database, row: ApiKeyRow): Promise<ApiPrincipal> {
	const owned = await db
		.prepare("SELECT id FROM spaces WHERE owner_key_id = ?")
		.bind(row.id)
		.all<{ id: string }>();
	return {
		id: row.id,
		name: row.name,
		role: row.role,
		ops: parseOps(row.ops),
		scope: row.scope,
		spaceIds: parseSpaceIds(row.space_ids_json),
		ownedSpaceIds: owned.results.map((item) => item.id),
		ownEntriesOnly: row.own_entries_only === 1,
		autoOwnSpace: row.auto_own_space === 1,
		expiresAt: row.expires_at,
	};
}

export function enqueueWaitUntil(
	ctx: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } },
	task: Promise<unknown>,
): void {
	try {
		const waitUntil = ctx.executionCtx?.waitUntil.bind(ctx.executionCtx);
		if (waitUntil) {
			waitUntil(task);
			return;
		}
	} catch {
		void task;
		return;
	}
	void task;
}

export async function authenticateBearer(
	request: Request,
	env: Env,
	waitUntil?: (task: Promise<unknown>) => void,
	now = Date.now(),
): Promise<ApiPrincipal> {
	const token = extractBearer(request.headers.get("Authorization"));
	const pepper = env.API_KEY_PEPPER;
	if (!token || !pepper) {
		throw new ApiError("unauthenticated", "unauthenticated");
	}
	const row = await lookupApiKey(env.DB, pepper, token, now);
	if (!row) {
		throw new ApiError("unauthenticated", "unauthenticated");
	}
	const principal = await hydrateApiKey(env.DB, row);
	waitUntil?.(touchLastUsed(env.DB, row.id, now).catch(() => undefined));
	return principal;
}

export async function bearerMiddleware(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
	next: Next,
): Promise<void> {
	const principal = await authenticateBearer(c.req.raw, c.env, (task) => enqueueWaitUntil(c, task));
	c.set("apiKey", principal);
	await next();
}
