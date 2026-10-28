import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { libraryError } from "./library";
import { memoryTypeLabels } from "./memories";

const DAY_MS = 86_400_000;

export const OVERVIEW_RANGES = [7, 30, 90] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];
export const DEFAULT_RANGE: OverviewRange = 30;

export const OP_BUCKETS = [
	{ key: "created", label: "创建" },
	{ key: "updated", label: "更新" },
	{ key: "moved", label: "移动" },
	{ key: "restored", label: "恢复" },
	{ key: "rolled_back", label: "回滚" },
	{ key: "trashed", label: "回收站" },
	{ key: "purged", label: "永久删除" },
] as const;
export type OpBucket = (typeof OP_BUCKETS)[number]["key"];
const OPERATION_BUCKETS: Record<string, OpBucket> = {
	created: "created",
	updated: "updated",
	moved: "moved",
	moved_out: "moved",
	restored: "restored",
	rolled_back: "rolled_back",
	trashed: "trashed",
	purged: "purged",
};

export type DashboardOperation = {
	day: string;
	actor: string;
	space_id: string;
	op: string;
	count: number;
};
export type DashboardUsage = {
	day: string;
	key_id: string;
	calls: number;
	errors: number;
	writes: number;
};
export type DashboardTypeCount = { space_id: string; type: string; count: number };
export type DashboardSpace = {
	id: string;
	slug: string;
	name: string;
	memories: number;
	trash: number;
};
export type DashboardKey = {
	id: string;
	name: string;
	role: string;
	revoked: boolean;
	last_used_at: string | null;
};
export type DashboardPayload = {
	range: { from: string; to: string; days: number };
	totals: { memories: number; trash: number; spaces: number; keys: number };
	ops: DashboardOperation[];
	usage: DashboardUsage[];
	types: DashboardTypeCount[];
	spaces: DashboardSpace[];
	keys: DashboardKey[];
};

export type DailyRow = {
	x: string;
	net: number;
	calls: number;
	errors: number;
	writes: number;
	errorRate: number | null;
} & Record<OpBucket, number>;

export type SeriesDescriptor = { key: string; label: string; colorIndex: number; id: string };
export type SeriesChart = { rows: Record<string, string | number>[]; series: SeriesDescriptor[] };
export type NamedValue = { key: string; name: string; value: number };
export type SeriesPoint = { x: string; value: number };

export type BotRow = {
	id: string;
	name: string;
	role: string;
	revoked: boolean;
	lastUsed: string | null;
	calls: number;
	errors: number;
	writes: number;
	ops: number;
	errorRate: number | null;
	share: number;
	sparkline: SeriesPoint[];
};

export type SpaceRow = {
	id: string;
	slug: string;
	name: string;
	memories: number;
	trash: number;
	ops: number;
	share: number;
	sparkline: SeriesPoint[];
};

export type OverviewSummary = {
	memories: number;
	trash: number;
	spaces: number;
	bots: number;
	activeBots: number;
	ops: number;
	net: number;
	calls: number;
	errors: number;
	errorRate: number | null;
	dailyOps: number;
};

export function parseOverviewRange(params: URLSearchParams): OverviewRange {
	const raw = Number(params.get("range"));
	return OVERVIEW_RANGES.find((range) => range === raw) ?? DEFAULT_RANGE;
}

export function rangeWindow(range: OverviewRange, now: number): { from: string; to: string } {
	const to = new Date(now).toISOString().slice(0, 10);
	const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - (range - 1) * DAY_MS)
		.toISOString()
		.slice(0, 10);
	return { from, to };
}

function daysOf(data: DashboardPayload): string[] {
	return Array.from({ length: data.range.days }, (_, index) =>
		new Date(Date.parse(`${data.range.from}T00:00:00.000Z`) + index * DAY_MS)
			.toISOString()
			.slice(0, 10),
	);
}

export function bucketOf(op: string): OpBucket | null {
	return Object.hasOwn(OPERATION_BUCKETS, op) ? (OPERATION_BUCKETS[op] as OpBucket) : null;
}

export function actorId(actor: string): string {
	return actor.startsWith("key:") ? actor.slice(4) : "admin";
}

export function botName(id: string, keys: DashboardKey[]): string {
	if (id === "admin") return "控制台";
	return keys.find((key) => key.id === id)?.name ?? id;
}

function rate(errors: number, calls: number): number | null {
	return calls > 0 ? errors / calls : null;
}

function share(value: number, total: number): number {
	return total > 0 ? value / total : 0;
}

export function dailySeries(data: DashboardPayload): DailyRow[] {
	const rows = new Map<string, DailyRow>(
		daysOf(data).map((day) => [
			day,
			{
				x: day,
				created: 0,
				updated: 0,
				moved: 0,
				restored: 0,
				rolled_back: 0,
				trashed: 0,
				purged: 0,
				net: 0,
				calls: 0,
				errors: 0,
				writes: 0,
				errorRate: null,
			},
		]),
	);
	for (const operation of data.ops) {
		const bucket = bucketOf(operation.op);
		const row = rows.get(operation.day);
		if (row && bucket) row[bucket] += operation.count;
	}
	for (const usage of data.usage) {
		const row = rows.get(usage.day);
		if (!row) continue;
		row.calls += usage.calls;
		row.errors += usage.errors;
		row.writes += usage.writes;
	}
	for (const row of rows.values()) {
		row.net = row.created - row.purged;
		row.errorRate = rate(row.errors, row.calls);
	}
	return [...rows.values()];
}

export function operationTotals(rows: DailyRow[]): NamedValue[] {
	return OP_BUCKETS.map((bucket) => ({
		key: bucket.key,
		name: bucket.label,
		value: rows.reduce((sum, row) => sum + row[bucket.key], 0),
	})).filter((item) => item.value > 0);
}

type Metric = { total: number; byDay: Map<string, number> };

function accumulate(metrics: Map<string, Metric>, id: string, day: string, count: number): void {
	const metric = metrics.get(id) ?? { total: 0, byDay: new Map<string, number>() };
	metric.total += count;
	metric.byDay.set(day, (metric.byDay.get(day) ?? 0) + count);
	metrics.set(id, metric);
}

function stackSeries(
	days: string[],
	metrics: Map<string, Metric>,
	limit: number,
	describe: (id: string) => string,
): SeriesChart {
	const entries = [...metrics.entries()]
		.filter(([, metric]) => metric.total > 0)
		.sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0]));
	const kept = entries.slice(0, limit);
	const rest = entries.slice(limit);
	const series: SeriesDescriptor[] = kept.map(([id], index) => ({
		key: `s${index}`,
		label: describe(id),
		id,
		colorIndex: index,
	}));
	if (rest.length > 0) {
		series.push({
			key: `s${kept.length}`,
			label: `其他 ${rest.length} 项`,
			id: "other",
			colorIndex: -1,
		});
	}
	const rows = days.map((day) => {
		const row: Record<string, string | number> = { x: day };
		kept.forEach(([, metric], index) => {
			row[`s${index}`] = metric.byDay.get(day) ?? 0;
		});
		if (rest.length > 0) {
			row[`s${kept.length}`] = rest.reduce(
				(sum, [, metric]) => sum + (metric.byDay.get(day) ?? 0),
				0,
			);
		}
		return row;
	});
	return { rows, series };
}

export function spaceOperations(data: DashboardPayload, limit = 5): SeriesChart {
	const metrics = new Map<string, Metric>();
	for (const operation of data.ops) {
		if (!bucketOf(operation.op)) continue;
		accumulate(metrics, operation.space_id, operation.day, operation.count);
	}
	return stackSeries(daysOf(data), metrics, limit, (id) => {
		return data.spaces.find((space) => space.id === id)?.name ?? id;
	});
}

export function botOperations(data: DashboardPayload, limit = 5): SeriesChart {
	const metrics = new Map<string, Metric>();
	for (const operation of data.ops) {
		if (!bucketOf(operation.op)) continue;
		accumulate(metrics, actorId(operation.actor), operation.day, operation.count);
	}
	return stackSeries(daysOf(data), metrics, limit, (id) => botName(id, data.keys));
}

export function botCalls(data: DashboardPayload, limit = 5): SeriesChart {
	const metrics = new Map<string, Metric>();
	for (const usage of data.usage) {
		accumulate(metrics, usage.key_id, usage.day, usage.calls);
	}
	return stackSeries(daysOf(data), metrics, limit, (id) => botName(id, data.keys));
}

export function typeDistribution(data: DashboardPayload): NamedValue[] {
	const totals = new Map<string, number>();
	for (const type of data.types) {
		totals.set(type.type, (totals.get(type.type) ?? 0) + type.count);
	}
	return [...totals.entries()]
		.map(([type, value]) => ({ key: type, name: memoryTypeLabels[type] ?? type, value }))
		.sort((left, right) => right.value - left.value || left.key.localeCompare(right.key));
}

export function spaceDistribution(data: DashboardPayload, limit = 6): NamedValue[] {
	const totals = new Map<string, number>();
	for (const space of data.spaces) {
		if (space.memories > 0) totals.set(space.id, space.memories);
	}
	const entries = [...totals.entries()].sort(
		(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
	);
	const items = entries.slice(0, limit).map(([id, value]) => ({
		key: id,
		name: data.spaces.find((space) => space.id === id)?.name ?? id,
		value,
	}));
	const rest = entries.slice(limit);
	if (rest.length > 0) {
		items.push({
			key: "other",
			name: `其他 ${rest.length} 个空间`,
			value: rest.reduce((sum, [, value]) => sum + value, 0),
		});
	}
	return items;
}

export function summary(data: DashboardPayload, series: DailyRow[]): OverviewSummary {
	const ops = series.reduce((sum, row) => sum + OP_BUCKETS.reduce((n, b) => n + row[b.key], 0), 0);
	const calls = series.reduce((sum, row) => sum + row.calls, 0);
	const errors = series.reduce((sum, row) => sum + row.errors, 0);
	const active = new Set<string>();
	for (const operation of data.ops) {
		const id = actorId(operation.actor);
		if (id !== "admin") active.add(id);
	}
	for (const usage of data.usage) {
		if (usage.calls > 0) active.add(usage.key_id);
	}
	return {
		memories: data.totals.memories,
		trash: data.totals.trash,
		spaces: data.totals.spaces,
		bots: data.totals.keys,
		activeBots: active.size,
		ops,
		net: series.reduce((sum, row) => sum + row.net, 0),
		calls,
		errors,
		errorRate: rate(errors, calls),
		dailyOps: data.range.days > 0 ? ops / data.range.days : 0,
	};
}

export function topBots(data: DashboardPayload): BotRow[] {
	const days = daysOf(data);
	const rows = new Map<string, BotRow>(
		data.keys.map((key) => [
			key.id,
			{
				id: key.id,
				name: key.name,
				role: key.role,
				revoked: key.revoked,
				lastUsed: key.last_used_at,
				calls: 0,
				errors: 0,
				writes: 0,
				ops: 0,
				errorRate: null,
				share: 0,
				sparkline: days.map((day) => ({ x: day, value: 0 })),
			},
		]),
	);
	const daily = new Map<string, Map<string, number>>();
	for (const operation of data.ops) {
		const row = rows.get(actorId(operation.actor));
		if (!row || !bucketOf(operation.op)) continue;
		row.ops += operation.count;
		const values = daily.get(row.id) ?? new Map<string, number>();
		values.set(operation.day, (values.get(operation.day) ?? 0) + operation.count);
		daily.set(row.id, values);
	}
	for (const usage of data.usage) {
		const row = rows.get(usage.key_id);
		if (!row) continue;
		row.calls += usage.calls;
		row.errors += usage.errors;
		row.writes += usage.writes;
	}
	const total = [...rows.values()].reduce((sum, row) => sum + row.calls, 0);
	for (const row of rows.values()) {
		row.errorRate = rate(row.errors, row.calls);
		row.share = share(row.calls, total);
		row.sparkline = days.map((day) => ({ x: day, value: daily.get(row.id)?.get(day) ?? 0 }));
	}
	return [...rows.values()]
		.filter((row) => row.calls > 0 || row.ops > 0)
		.sort(
			(left, right) =>
				right.calls - left.calls || right.ops - left.ops || left.name.localeCompare(right.name),
		);
}

export function topSpaces(data: DashboardPayload, limit = 6): SpaceRow[] {
	const days = daysOf(data);
	const daily = new Map<string, Map<string, number>>();
	const ops = new Map<string, number>();
	for (const operation of data.ops) {
		if (!bucketOf(operation.op)) continue;
		ops.set(operation.space_id, (ops.get(operation.space_id) ?? 0) + operation.count);
		const values = daily.get(operation.space_id) ?? new Map<string, number>();
		values.set(operation.day, (values.get(operation.day) ?? 0) + operation.count);
		daily.set(operation.space_id, values);
	}
	const totalMemories = data.spaces.reduce((sum, space) => sum + space.memories, 0);
	return data.spaces
		.map((space) => ({
			id: space.id,
			slug: space.slug,
			name: space.name,
			memories: space.memories,
			trash: space.trash,
			ops: ops.get(space.id) ?? 0,
			share: share(space.memories, totalMemories),
			sparkline: days.map((day) => ({ x: day, value: daily.get(space.id)?.get(day) ?? 0 })),
		}))
		.sort(
			(left, right) =>
				right.ops - left.ops ||
				right.memories - left.memories ||
				left.name.localeCompare(right.name),
		)
		.slice(0, limit);
}

export type BotDetail = {
	bot: BotRow | null;
	series: DailyRow[];
	spaces: { id: string; name: string; ops: number; memories: number }[];
	totals: { ops: number; calls: number; errors: number; writes: number; errorRate: number | null };
};

export function botDetail(data: DashboardPayload, id: string): BotDetail {
	const scoped: DashboardPayload = {
		...data,
		ops: data.ops.filter((operation) => actorId(operation.actor) === id),
		usage: data.usage.filter((usage) => usage.key_id === id),
	};
	const series = dailySeries(scoped);
	const spaces = new Map<string, number>();
	for (const operation of scoped.ops) {
		if (!bucketOf(operation.op)) continue;
		spaces.set(operation.space_id, (spaces.get(operation.space_id) ?? 0) + operation.count);
	}
	const calls = series.reduce((sum, row) => sum + row.calls, 0);
	const errors = series.reduce((sum, row) => sum + row.errors, 0);
	return {
		bot: topBots(data).find((row) => row.id === id) ?? null,
		series,
		spaces: [...spaces.entries()]
			.map(([spaceId, count]) => {
				const space = data.spaces.find((item) => item.id === spaceId);
				return {
					id: spaceId,
					name: space?.name ?? spaceId,
					ops: count,
					memories: space?.memories ?? 0,
				};
			})
			.sort((left, right) => right.ops - left.ops || left.name.localeCompare(right.name)),
		totals: {
			ops: series.reduce((sum, row) => sum + OP_BUCKETS.reduce((n, b) => n + row[b.key], 0), 0),
			calls,
			errors,
			writes: series.reduce((sum, row) => sum + row.writes, 0),
			errorRate: rate(errors, calls),
		},
	};
}

export type SpaceDetail = {
	space: SpaceRow | null;
	series: DailyRow[];
	types: NamedValue[];
	bots: { id: string; name: string; ops: number }[];
	totals: { ops: number; net: number; memories: number; trash: number };
};

export function spaceDetail(data: DashboardPayload, id: string): SpaceDetail {
	const scoped: DashboardPayload = {
		...data,
		ops: data.ops.filter((operation) => operation.space_id === id),
		usage: [],
		types: data.types.filter((type) => type.space_id === id),
	};
	const series = dailySeries(scoped);
	const bots = new Map<string, number>();
	for (const operation of scoped.ops) {
		if (!bucketOf(operation.op)) continue;
		const botId = actorId(operation.actor);
		bots.set(botId, (bots.get(botId) ?? 0) + operation.count);
	}
	const typeTotals = new Map<string, number>();
	for (const type of scoped.types) {
		typeTotals.set(type.type, (typeTotals.get(type.type) ?? 0) + type.count);
	}
	return {
		space: topSpaces(data, data.spaces.length).find((row) => row.id === id) ?? null,
		series,
		types: [...typeTotals.entries()]
			.map(([type, value]) => ({ key: type, name: memoryTypeLabels[type] ?? type, value }))
			.sort((left, right) => right.value - left.value || left.key.localeCompare(right.key)),
		bots: [...bots.entries()]
			.map(([botId, count]) => ({ id: botId, name: botName(botId, data.keys), ops: count }))
			.sort((left, right) => right.ops - left.ops || left.name.localeCompare(right.name)),
		totals: {
			ops: series.reduce((sum, row) => sum + OP_BUCKETS.reduce((n, b) => n + row[b.key], 0), 0),
			net: series.reduce((sum, row) => sum + row.net, 0),
			memories: data.spaces.find((space) => space.id === id)?.memories ?? 0,
			trash: data.spaces.find((space) => space.id === id)?.trash ?? 0,
		},
	};
}

interface OverviewState {
	loading: boolean;
	error: string | null;
	data: DashboardPayload | null;
}

export class OverviewModel extends Store<OverviewState> {
	constructor(
		private readonly api: AdminClient = adminApi,
		private readonly now: () => number = Date.now,
	) {
		super({ loading: false, error: null, data: null });
	}
	private request = 0;

	async load(range: OverviewRange): Promise<void> {
		this.request += 1;
		const request = this.request;
		this.set({ loading: true, error: null });
		try {
			const { from, to } = rangeWindow(range, this.now());
			const data = await this.api.request<DashboardPayload>(`/dashboard?from=${from}&to=${to}`);
			if (request === this.request) this.set({ data });
		} catch (error) {
			if (request === this.request) this.set({ error: `无法刷新总览：${libraryError(error)}` });
		} finally {
			if (request === this.request) this.set({ loading: false });
		}
	}
}
