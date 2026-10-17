import type { MiddlewareHandler } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { parseIdempotencyKey } from "./idempotency-key";
import { findIdempotencyRecord, insertIdempotencyRecord } from "./idempotency-repo";
import { requestHash } from "./request-hash";

export function idempotencyMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> {
	return async (c, next) => {
		if (c.req.method === "GET" || !c.req.path.startsWith("/api/v1/")) {
			await next();
			return;
		}
		const idemKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
		if (!idemKey) {
			await next();
			return;
		}
		const keyId = c.get("apiKey")?.id;
		if (!keyId) {
			throw new ApiError("unauthenticated", "unauthenticated");
		}
		const rawBody = await c.req.raw.clone().text();
		const hash = await requestHash(c.req.method, c.req.path, rawBody);
		const existing = await findIdempotencyRecord(c.env.DB, keyId, idemKey);
		if (existing) {
			if (existing.request_hash !== hash) {
				throw new ApiError("idempotency_conflict", "idempotency key reused with different request");
			}
			return new Response(existing.response_json, {
				status: existing.status,
				headers: {
					"content-type": "application/json; charset=utf-8",
					"Idempotent-Replayed": "true",
				},
			});
		}
		await next();
		const bodyText = await c.res.clone().text();
		const stored = await insertIdempotencyRecord(c.env.DB, {
			key_id: keyId,
			idem_key: idemKey,
			request_hash: hash,
			status: c.res.status,
			response_json: bodyText,
			created_at: Date.now(),
		});
		if (!stored) {
			const raced = await findIdempotencyRecord(c.env.DB, keyId, idemKey);
			if (raced && raced.request_hash === hash) {
				return new Response(raced.response_json, {
					status: raced.status,
					headers: {
						"content-type": "application/json; charset=utf-8",
						"Idempotent-Replayed": "true",
					},
				});
			}
			if (raced && raced.request_hash !== hash) {
				throw new ApiError("idempotency_conflict", "idempotency key reused with different request");
			}
		}
	};
}
