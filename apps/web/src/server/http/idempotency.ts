import type { Context, MiddlewareHandler } from "hono";
import { errorCodeSchema } from "../../lib/schema/errors";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { authorizeBatchReplay, prepareBatchAuthorization } from "./batch-authorization";
import { parseIdempotencyKey } from "./idempotency-key";
import { commitIdempotencyOutcome, readIdempotencyResponse } from "./idempotency-repo";
import { authorizeMemoryRequest } from "./memory-authorization";
import { requestHash } from "./request-hash";

function replayResponse(
	context: Context<{ Bindings: Env; Variables: AppVars }>,
	outcome: { status: number; body: string },
	prefix: string,
): Response {
	const headers = new Headers({
		"content-type": "application/json; charset=utf-8",
		"Idempotent-Replayed": "true",
	});
	if (
		context.req.method === "PATCH" &&
		/^\/spaces\/[^/]+\/?$/.test(context.req.path.slice(prefix.length))
	) {
		context.header("ETag", undefined);
		context.header("Content-Length", undefined);
		if (outcome.status >= 200 && outcome.status < 300) {
			try {
				const updatedAt = JSON.parse(outcome.body)?.updated_at;
				if (typeof updatedAt === "string") {
					const version = Date.parse(updatedAt);
					if (Number.isFinite(version)) headers.set("ETag", `"${version}"`);
				}
			} catch {}
		}
	}
	if (outcome.status >= 400) {
		try {
			const parsed = errorCodeSchema.safeParse(JSON.parse(outcome.body)?.error?.code);
			if (parsed.success) context.set("responseErrorCode", parsed.data);
		} catch {}
	}
	return new Response(outcome.body, {
		status: outcome.status,
		headers,
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
		console.error("write compensation failed", { request_id: context.get("requestId") });
		return unavailable;
	}
}

export function idempotencyMiddleware(
	prefix = "/api/v1",
): MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> {
	return async (c, next) => {
		if (
			c.req.method === "GET" ||
			!c.req.path.startsWith(`${prefix}/`) ||
			(c.req.method === "POST" &&
				(c.req.path === `${prefix}/search` || c.req.path === `${prefix}/memories:batchGet`))
		) {
			await next();
			return;
		}
		const writes: D1PreparedStatement[] = [];
		c.set("writeStatements", writes);
		await authorizeMemoryRequest(c, undefined, prefix);
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
			c.get("requestHashBody") ?? (await c.req.raw.clone().text()),
			c.req.header("If-Match"),
		);
		try {
			const existing = await readIdempotencyResponse(c.env.DB, keyId, key, hash);
			if (existing) {
				await authorizeMemoryRequest(c, existing, prefix);
				await authorizeBatchReplay(c, existing, prefix);
				return replayResponse(c, existing, prefix);
			}
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw new ApiError("unavailable", "idempotency store unavailable");
		}
		await prepareBatchAuthorization(c, prefix);
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
			const writeError = await writeFailure(
				c,
				commitError,
				"write transaction unavailable; retry with the same key",
			);
			try {
				const outcome = await readIdempotencyResponse(c.env.DB, keyId, key, hash);
				if (outcome) {
					await authorizeMemoryRequest(c, outcome, prefix);
					await authorizeBatchReplay(c, outcome, prefix);
					c.res = replayResponse(c, outcome, prefix);
					return;
				}
			} catch (err) {
				if (err instanceof ApiError) throw err;
				throw new ApiError("unavailable", "idempotency recovery unavailable");
			}
			throw writeError;
		}
	};
}
