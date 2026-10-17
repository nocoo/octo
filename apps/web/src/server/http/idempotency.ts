import type { Context, MiddlewareHandler } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { authorizeBatchReplay, prepareBatchAuthorization } from "./batch-authorization";
import { parseIdempotencyKey } from "./idempotency-key";
import { commitIdempotencyOutcome, readIdempotencyResponse } from "./idempotency-repo";
import { authorizeMemoryRequest } from "./memory-authorization";
import { requestHash } from "./request-hash";

function replayResponse(outcome: { status: number; body: string }): Response {
	return new Response(outcome.body, {
		status: outcome.status,
		headers: { "content-type": "application/json; charset=utf-8", "Idempotent-Replayed": "true" },
	});
}

async function writeFailure(
	context: Context<{ Bindings: Env; Variables: AppVars }>,
	error: unknown,
	message: string,
): Promise<ApiError> {
	const unavailable = new ApiError("unavailable", message);
	try {
		return (await context.get("writeError")?.(error)) ?? unavailable;
	} catch {
		return unavailable;
	}
}

export function idempotencyMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> {
	return async (c, next) => {
		if (
			c.req.method === "GET" ||
			!c.req.path.startsWith("/api/v1/") ||
			(c.req.method === "POST" &&
				(c.req.path === "/api/v1/search" || c.req.path === "/api/v1/memories:batchGet"))
		) {
			await next();
			return;
		}
		const writes: D1PreparedStatement[] = [];
		c.set("writeStatements", writes);
		await authorizeMemoryRequest(c);
		const key = parseIdempotencyKey(c.req.header("Idempotency-Key"));
		if (key === null) {
			await next();
			if (c.res.status < 400 && writes.length > 0) {
				try {
					await c.env.DB.batch(writes);
				} catch (err) {
					throw await writeFailure(c, err, "write transaction failed");
				}
			}
			return;
		}
		const keyId = c.get("apiKey")?.id;
		if (!keyId) throw new ApiError("unauthenticated", "unauthenticated");
		const hash = await requestHash(
			c.req.method,
			c.req.path,
			await c.req.raw.clone().text(),
			c.req.header("If-Match"),
		);
		try {
			const existing = await readIdempotencyResponse(c.env.DB, keyId, key, hash);
			if (existing) {
				await authorizeMemoryRequest(c, existing);
				await authorizeBatchReplay(c, existing);
				return replayResponse(existing);
			}
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError("unavailable", "idempotency store unavailable");
		}
		await prepareBatchAuthorization(c);
		await next();
		const body = await c.res.clone().text();
		try {
			await commitIdempotencyOutcome(
				c.env.DB,
				keyId,
				key,
				hash,
				c.res.status,
				body,
				c.res.status < 400 ? writes : [],
			);
		} catch (commitError) {
			try {
				const outcome = await readIdempotencyResponse(c.env.DB, keyId, key, hash);
				if (outcome) {
					await authorizeMemoryRequest(c, outcome);
					await authorizeBatchReplay(c, outcome);
					c.res = replayResponse(outcome);
					return;
				}
			} catch (err) {
				if (err instanceof ApiError) throw err;
				throw new ApiError("unavailable", "idempotency recovery unavailable");
			}
			throw await writeFailure(
				c,
				commitError,
				"write transaction unavailable; retry with the same key",
			);
		}
	};
}
