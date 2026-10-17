import type { MiddlewareHandler } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { parseIdempotencyKey } from "./idempotency-key";
import {
	claimIdempotencyKey,
	completeIdempotencyRecord,
	releaseIdempotencyClaim,
	waitForIdempotencyReplay,
} from "./idempotency-repo";
import { requestHash } from "./request-hash";

function replayResponse(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"Idempotent-Replayed": "true",
		},
	});
}

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
		const now = Date.now();
		let claim = await claimIdempotencyKey(c.env.DB, keyId, idemKey, hash, now);
		if (claim.kind === "replay") {
			return replayResponse(claim.status, claim.body);
		}
		if (claim.kind !== "claimed") {
			claim = await waitForIdempotencyReplay(c.env.DB, keyId, idemKey, hash);
			if (claim.kind === "replay") {
				return replayResponse(claim.status, claim.body);
			}
			if (claim.kind === "in_progress") {
				throw new ApiError("unavailable", "idempotent request still processing");
			}
			throw new ApiError("idempotency_conflict", "idempotency key reused with different request");
		}
		try {
			await next();
		} catch (err) {
			await releaseIdempotencyClaim(c.env.DB, keyId, idemKey, hash);
			throw err;
		}
		const bodyText = await c.res.clone().text();
		try {
			await completeIdempotencyRecord(c.env.DB, keyId, idemKey, hash, c.res.status, bodyText, now);
		} catch (storeErr) {
			if (storeErr instanceof ApiError) {
				throw storeErr;
			}
			throw new ApiError("internal", "idempotency store failed");
		}
	};
}
