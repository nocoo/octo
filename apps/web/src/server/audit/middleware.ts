import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { hashSecret } from "../auth/api-key";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";

type AuditContext = Context<{ Bindings: Env; Variables: AppVars }>;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STATUS_CODES: Record<number, string> = {
	400: "validation_failed",
	401: "unauthenticated",
	403: "forbidden",
	404: "not_found",
	413: "payload_too_large",
	415: "unsupported_media_type",
	422: "unprocessable",
	500: "internal",
	503: "unavailable",
};

function byteLength(value: string | null): number | null {
	if (value === null || !/^\d{1,10}$/.test(value)) return null;
	const n = Number(value);
	return n <= 4_294_967_295 ? n : null;
}

async function writeAudit(c: AuditContext, started: number): Promise<void> {
	const key = c.get("apiKey");
	const email = c.get("adminEmail");
	const actor = email ? `admin:${email}` : key ? `key:${key.id}` : "anonymous";
	const route = matchedRoutes(c)
		.reverse()
		.find((entry) => entry.method !== "ALL");
	const template = route ? route.path.replace(/\{[^}]*\}/g, "") : "unmatched";
	const status = c.res.status;
	const errorCode =
		status < 400
			? null
			: c.error instanceof ApiError
				? c.error.code
				: (STATUS_CODES[status] ?? "internal");
	const requestId = c.get("requestId");
	const safeRequestId =
		typeof requestId === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
			? requestId
			: crypto.randomUUID();
	const duration = Math.max(0, Date.now() - started);
	const input = byteLength(c.req.raw.headers.get("Content-Length"));
	const output = byteLength(c.res.headers.get("Content-Length"));
	const ip = c.req.raw.headers.get("CF-Connecting-IP");
	const pepper = c.env.API_KEY_PEPPER;
	const ipHash = ip && pepper ? await hashSecret(pepper, ip) : null;
	await c.env.DB.prepare(
		`INSERT INTO audit_log
		(id, at, actor, method, route, status, error_code, request_id, duration_ms, bytes_in, bytes_out, ip_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newUlid(started),
			started,
			actor,
			METHODS.has(c.req.method) ? c.req.method : "OTHER",
			template,
			status,
			errorCode,
			safeRequestId,
			duration,
			input,
			output,
			ipHash,
		)
		.run();
}

export const auditMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> = async (
	c,
	next,
) => {
	const started = Date.now();
	await next();
	const task = writeAudit(c, started).catch(() => {
		console.error("audit_write_failed");
	});
	try {
		c.executionCtx.waitUntil(task);
	} catch {
		void task;
	}
};
