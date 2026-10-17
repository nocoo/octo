import { z } from "zod";
import type { Env } from "../env";
import { cursorSecretFromEnv, decodeCursor, encodeCursor } from "../http/cursor";
import { ApiError } from "../lib/errors";
import { listEnvelope } from "../lib/http";
import { parseStrict } from "../lib/validate";
import { daySchema, keyIdSchema, pageFields, readQuery, validateRange } from "./query";

const querySchema = z.strictObject({
	...pageFields,
	from: daySchema.optional(),
	to: daySchema.optional(),
	key_id: z.string().optional(),
});
const cursorSchema = z.strictObject({
	kind: z.literal("usage"),
	filter: z.string(),
	day: daySchema,
	key_id: keyIdSchema,
});

type UsageRow = {
	day: string;
	key_id: string;
	calls: number;
	errors: number;
	writes: number;
	bytes_in: number;
	bytes_out: number;
};

export async function queryUsage(env: Env, query: Record<string, string[]>, callerKeyId?: string) {
	const filters = readQuery(querySchema, query);
	validateRange(filters.from, filters.to);
	const keyId =
		callerKeyId ??
		(filters.key_id === undefined ? undefined : parseStrict(keyIdSchema, filters.key_id));
	const filter = JSON.stringify([filters.from, filters.to, keyId]);
	const where: string[] = ["1 = 1"];
	const values: string[] = [];
	for (const [column, value, operator] of [
		["day", filters.from, ">="],
		["day", filters.to, "<="],
		["key_id", keyId, "="],
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
		where.push("(day < ? OR (day = ? AND key_id < ?))");
		values.push(cursor.day, cursor.day, cursor.key_id);
	}
	const result = await env.DB.prepare(
		`SELECT day, key_id, calls, errors, writes, bytes_in, bytes_out FROM usage_daily
		WHERE ${where.join(" AND ")} ORDER BY day DESC, key_id DESC LIMIT ?`,
	)
		.bind(...values, filters.limit + 1)
		.all<UsageRow>();
	const items = result.results.slice(0, filters.limit);
	const last = items.at(-1);
	const next =
		result.results.length > filters.limit && last
			? await encodeCursor(cursorSecretFromEnv(env), {
					kind: "usage",
					filter,
					day: last.day,
					key_id: last.key_id,
				})
			: null;
	return listEnvelope(items, next);
}
