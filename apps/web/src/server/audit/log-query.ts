import { z } from "zod";
import type { Env } from "../env";
import { cursorSecretFromEnv, decodeCursor, encodeCursor } from "../http/cursor";
import { ApiError } from "../lib/errors";
import { isoUtc, listEnvelope } from "../lib/http";
import { parseStrict } from "../lib/validate";
import { daySchema, pageFields, readQuery, validateRange } from "./query";

const timeSchema = z.union([daySchema, z.iso.datetime()]);
const querySchema = z.strictObject({
	...pageFields,
	from: timeSchema.optional(),
	to: timeSchema.optional(),
	actor: z
		.string()
		.max(320)
		.regex(/^(?:anonymous|key:[A-Z2-7]{12}|admin:[^\s@]+@[^\s@]+)$/)
		.optional(),
	action: z
		.union([
			z.literal("unmatched"),
			z
				.string()
				.min(1)
				.max(512)
				.regex(/^\/[A-Za-z0-9_./:*-]*$/),
		])
		.optional(),
	status: z
		.string()
		.regex(/^[1-5]\d{2}$/)
		.transform(Number)
		.optional(),
});
const cursorSchema = z.strictObject({
	kind: z.literal("audit"),
	filter: z.string(),
	at: z.number().int().nonnegative(),
	id: z.string().min(1).max(128),
});

type AuditRow = {
	id: string;
	at: number;
	actor: string;
	method: string;
	route: string;
	status: number;
	error_code: string | null;
	request_id: string;
	duration_ms: number;
	bytes_in: number | null;
	bytes_out: number | null;
	ip_hash: string | null;
};

export async function queryAudit(env: Env, query: Record<string, string[]>) {
	const filters = readQuery(querySchema, query);
	const from = filters.from === undefined ? undefined : Date.parse(filters.from);
	const to =
		filters.to === undefined
			? undefined
			: Date.parse(filters.to) + (filters.to.length === 10 ? 86_400_000 - 1 : 0);
	validateRange(from, to);
	const filter = JSON.stringify([from, to, filters.actor, filters.action, filters.status]);
	const where: string[] = ["1 = 1"];
	const values: (string | number)[] = [];
	for (const [column, value, operator] of [
		["at", from, ">="],
		["at", to, "<="],
		["actor", filters.actor, "="],
		["route", filters.action, "="],
		["status", filters.status, "="],
	] as const) {
		if (value !== undefined) {
			where.push(`${column} ${operator} ?`);
			values.push(value);
		}
	}
	if (filters.cursor) {
		const cursor = parseStrict(
			cursorSchema,
			await decodeCursor(cursorSecretFromEnv(env), filters.cursor),
		);
		if (cursor.filter !== filter) throw new ApiError("validation_failed", "cursor filter mismatch");
		where.push("(at < ? OR (at = ? AND id < ?))");
		values.push(cursor.at, cursor.at, cursor.id);
	}
	const result = await env.DB.prepare(
		`SELECT id, at, actor, method, route, status, error_code, request_id,
		duration_ms, bytes_in, bytes_out, ip_hash FROM audit_log
		WHERE ${where.join(" AND ")} ORDER BY at DESC, id DESC LIMIT ?`,
	)
		.bind(...values, filters.limit + 1)
		.all<AuditRow>();
	const items = result.results.slice(0, filters.limit);
	const last = items.at(-1);
	const next =
		result.results.length > filters.limit && last
			? await encodeCursor(cursorSecretFromEnv(env), {
					kind: "audit",
					filter,
					at: last.at,
					id: last.id,
				})
			: null;
	return listEnvelope(
		items.map((row) => ({ ...row, at: isoUtc(row.at) })),
		next,
	);
}
