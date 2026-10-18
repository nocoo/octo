import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { hashSecret } from "../auth/api-key";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";
import { usageIncrement } from "./usage";

type AuditContext = Context<{ Bindings: Env; Variables: AppVars }>;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STATUS_CODES: Record<number, string> = {
	400: "validation_failed",
	401: "unauthenticated",
	403: "forbidden",
	404: "not_found",
	405: "validation_failed",
	406: "validation_failed",
	413: "payload_too_large",
	415: "unsupported_media_type",
	422: "unprocessable",
	500: "internal",
	503: "unavailable",
};

function byteLength(value: string | null): number | null {
	if (value === null || !/^\d{1,10}$/.test(value)) return null;
	const length = Number(value);
	return length <= 4_294_967_295 ? length : null;
}

function responseBytes(context: AuditContext): number | Promise<number> {
	const response = context.res;
	if (context.req.method === "HEAD" || !response.body) return 0;
	const length = byteLength(response.headers.get("Content-Length"));
	if (length !== null) return length;
	let bytes = 0;
	const counter = new TransformStream<Uint8Array, Uint8Array>(
		{
			transform(chunk, controller) {
				controller.enqueue(chunk);
				bytes += chunk.byteLength;
			},
		},
		undefined,
		{ highWaterMark: 1 },
	);
	const finished = response.body.pipeTo(counter.writable).then(
		() => bytes,
		() => bytes,
	);
	context.res = new Response(counter.readable, response);
	return finished;
}

async function writeAudit(
	context: AuditContext,
	started: number,
	output: number | Promise<number>,
): Promise<void> {
	const key = context.get("apiKey");
	const email = context.get("adminEmail");
	const actor = email ? `admin:${email}` : key ? `key:${key.id}` : "anonymous";
	const route = matchedRoutes(context)
		.reverse()
		.find((entry) => entry.method !== "ALL" || entry.path === "/mcp");
	const template = route ? route.path.replace(/\{[^}]*\}/g, "") : "unmatched";
	const status = context.res.status;
	const errorCode =
		status < 400 && !context.get("responseErrorCode")
			? null
			: (context.get("responseErrorCode") ??
				(context.error instanceof ApiError
					? context.error.code
					: (STATUS_CODES[status] ?? "internal")));
	const requestId = context.get("requestId");
	const safeRequestId =
		typeof requestId === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
			? requestId
			: crypto.randomUUID();
	const duration = Math.max(0, Date.now() - started);
	const input = byteLength(context.req.raw.headers.get("Content-Length"));
	const ip = context.req.raw.headers.get("CF-Connecting-IP");
	const pepper = context.env.API_KEY_PEPPER;
	const bytes = await output;
	const ipHash = ip && pepper ? await hashSecret(pepper, ip) : null;
	const auditId = newUlid(started);
	const statement = context.env.DB.prepare(
		`INSERT INTO audit_log
		(id, at, actor, method, route, status, error_code, request_id, duration_ms, bytes_in, bytes_out, ip_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).bind(
		auditId,
		started,
		actor,
		METHODS.has(context.req.method) ? context.req.method : "OTHER",
		template,
		status,
		errorCode,
		safeRequestId,
		duration,
		input,
		bytes,
		ipHash,
	);
	const statements = [statement];
	if (context.get("mcpWrite")) {
		statements.push(
			context.env.DB.prepare("INSERT INTO mcp_audit_writes (audit_id) VALUES (?)").bind(auditId),
		);
	}
	if (key) statements.push(usageIncrement(context.env.DB, auditId));
	if (statements.length > 1) {
		await context.env.DB.batch(statements);
	} else {
		await statement.run();
	}
}

export const auditMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> = async (
	context,
	next,
) => {
	const started = Date.now();
	await next();
	const task = writeAudit(context, started, responseBytes(context)).catch(() => {
		console.error("audit_write_failed");
	});
	try {
		context.executionCtx.waitUntil(task);
	} catch {
		void task;
	}
};
