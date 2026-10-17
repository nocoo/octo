import { Hono } from "hono";
import type { ApiPrincipal } from "../../apps/web/src/server/auth/authorize";
import type { AppVars, Env } from "../../apps/web/src/server/env";
import { idempotencyMiddleware } from "../../apps/web/src/server/http/idempotency";
import { toErrorResponse } from "../../apps/web/src/server/lib/errors";
import { createBatchRoutes } from "../../apps/web/src/server/routes/v1/batch";
import {
	BatchMemoryService,
	type MemoryService,
	type MemoryServiceContext,
} from "../../apps/web/src/server/services/batch-memories";
import { testApiPrincipal } from "../../apps/web/src/server/test-principal";
import { sqliteD1 } from "./sqlite-d1";

export function batchFixture(
	service: MemoryService = new BatchMemoryService(),
	principal: ApiPrincipal = testApiPrincipal(),
) {
	const { db, sqlite } = sqliteD1();
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((err) => toErrorResponse(err, "test"));
	app.use("*", async (c, next) => {
		c.set("apiKey", principal);
		await next();
	});
	app.use("*", idempotencyMiddleware());
	app.route("/api/v1", createBatchRoutes(service));
	const ctx = (keyId = principal.id): MemoryServiceContext => ({
		db,
		statements: [],
		principal: testApiPrincipal(keyId),
	});
	const post = (action: string, body: unknown, headers: Record<string, string> = {}) =>
		app.request(
			`/api/v1/memories:batch${action}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify(body),
			},
			{ DB: db } as Env,
		);
	return { db, sqlite, app, ctx, post, service };
}
export const memoryInput = { space: "kb", title: "t", body: "b", type: "note" as const, tags: [] };
export type BatchResponse = {
	results: Array<{
		ok: boolean;
		error?: { code: string; details?: unknown };
		item?: { id: string; title: string; version: number; trashed_at?: string };
	}>;
};
