import { z } from "zod";
import { daySchema, readQuery, validateRange } from "../audit/query";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { isoUtc } from "../lib/http";

const DAY_MS = 86_400_000;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;
const querySchema = z.strictObject({ from: daySchema.optional(), to: daySchema.optional() });

export type DashboardRange = { from: string; to: string; days: number };
export type DashboardOpRow = {
	day: string;
	actor: string;
	space_id: string;
	op: string;
	count: number;
};
export type DashboardUsageRow = {
	day: string;
	key_id: string;
	calls: number;
	errors: number;
	writes: number;
};
export type DashboardTypeRow = { space_id: string; type: string; count: number };
export type DashboardSpaceRow = {
	id: string;
	slug: string;
	name: string;
	memories: number;
	trash: number;
};
export type DashboardKeyRow = {
	id: string;
	name: string;
	role: string;
	revoked: boolean;
	last_used_at: string | null;
};

export type DashboardPayload = {
	range: DashboardRange;
	totals: { memories: number; trash: number; spaces: number; keys: number };
	ops: DashboardOpRow[];
	usage: DashboardUsageRow[];
	types: DashboardTypeRow[];
	spaces: DashboardSpaceRow[];
	keys: DashboardKeyRow[];
};

export function resolveRange(
	from: string | undefined,
	to: string | undefined,
	now = Date.now(),
): DashboardRange {
	const end = to ?? new Date(now).toISOString().slice(0, 10);
	const start =
		from ??
		new Date(Date.parse(`${end}T00:00:00.000Z`) - (DEFAULT_DAYS - 1) * DAY_MS)
			.toISOString()
			.slice(0, 10);
	validateRange(start, end);
	const days =
		Math.round(
			(Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS,
		) + 1;
	if (days > MAX_DAYS) throw new ApiError("validation_failed", "invalid time range");
	return { from: start, to: end, days };
}

function count(value: unknown): number {
	return Number(value ?? 0);
}

export async function queryDashboard(
	env: Env,
	query: Record<string, string[]>,
	now = Date.now(),
): Promise<DashboardPayload> {
	const filters = readQuery(querySchema, query);
	const range = resolveRange(filters.from, filters.to, now);
	const startMs = Date.parse(`${range.from}T00:00:00.000Z`);
	const endMs = Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS;
	const [ops, usage, types, trash, spaces, keys] = await Promise.all([
		env.DB.prepare(
			`SELECT date(at / 1000, 'unixepoch') AS day, actor, space_id, op, COUNT(*) AS count
			FROM changes
			WHERE entity = 'memory' AND space_id IS NOT NULL AND at >= ? AND at < ?
			GROUP BY 1, 2, 3, 4
			ORDER BY 1`,
		)
			.bind(startMs, endMs)
			.all<DashboardOpRow>(),
		env.DB.prepare(
			`SELECT day, key_id, calls, errors, writes FROM usage_daily
			WHERE day >= ? AND day <= ? ORDER BY day, key_id`,
		)
			.bind(range.from, range.to)
			.all<DashboardUsageRow>(),
		env.DB.prepare(
			`SELECT space_id, type, COUNT(*) AS count FROM memories
			WHERE deleted_at IS NULL GROUP BY space_id, type`,
		).all<DashboardTypeRow>(),
		env.DB.prepare(
			`SELECT space_id, COUNT(*) AS count FROM memories
			WHERE deleted_at IS NOT NULL GROUP BY space_id`,
		).all<{ space_id: string; count: number }>(),
		env.DB.prepare("SELECT id, slug, name FROM spaces ORDER BY name").all<{
			id: string;
			slug: string;
			name: string;
		}>(),
		env.DB.prepare(
			"SELECT id, name, role, revoked_at, last_used_at FROM api_keys ORDER BY name",
		).all<{
			id: string;
			name: string;
			role: string;
			revoked_at: number | null;
			last_used_at: number | null;
		}>(),
	]);
	const memoryCounts = new Map<string, number>();
	for (const row of types.results) {
		memoryCounts.set(row.space_id, (memoryCounts.get(row.space_id) ?? 0) + count(row.count));
	}
	const trashCounts = new Map(
		trash.results.map((row) => [row.space_id, count(row.count)] as const),
	);
	const spaceRows = spaces.results.map((space) => ({
		id: space.id,
		slug: space.slug,
		name: space.name,
		memories: memoryCounts.get(space.id) ?? 0,
		trash: trashCounts.get(space.id) ?? 0,
	}));
	return {
		range,
		totals: {
			memories: [...memoryCounts.values()].reduce((sum, value) => sum + value, 0),
			trash: [...trashCounts.values()].reduce((sum, value) => sum + value, 0),
			spaces: spaceRows.length,
			keys: keys.results.length,
		},
		ops: ops.results.map((row) => ({
			day: row.day,
			actor: row.actor,
			space_id: row.space_id,
			op: row.op,
			count: count(row.count),
		})),
		usage: usage.results.map((row) => ({
			day: row.day,
			key_id: row.key_id,
			calls: count(row.calls),
			errors: count(row.errors),
			writes: count(row.writes),
		})),
		types: types.results.map((row) => ({
			space_id: row.space_id,
			type: row.type,
			count: count(row.count),
		})),
		spaces: spaceRows,
		keys: keys.results.map((row) => ({
			id: row.id,
			name: row.name,
			role: row.role,
			revoked: row.revoked_at !== null,
			last_used_at: row.last_used_at === null ? null : isoUtc(row.last_used_at),
		})),
	};
}
