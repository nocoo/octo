import type { MiddlewareHandler } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
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
					throw (
						(await c.get("writeError")?.(err)) ??
						new ApiError("unavailable", "write transaction failed")
					);
				}
			}
			return;
		}
		const keyId = c.get("apiKey")?.id;
		if (!keyId) throw new ApiError("unauthenticated", "unauthenticated");
		const hash = await requestHash(c.req.method, c.req.path, await c.req.raw.clone().text());
		try {
			const existing = await readIdempotencyResponse(c.env.DB, keyId, key, hash);
			if (existing) {
				await authorizeMemoryRequest(c, existing);
				return replayResponse(existing);
			}
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError("unavailable", "idempotency store unavailable");
		}
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
					c.res = replayResponse(outcome);
					return;
				}
			} catch (err) {
				if (err instanceof ApiError) throw err;
			}
			throw (
				(await c.get("writeError")?.(commitError)) ??
				new ApiError("unavailable", "write transaction unavailable; retry with the same key")
			);
		}
	};
}
