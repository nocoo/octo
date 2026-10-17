import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";

export interface UsageDaily {
	day: string;
	key_id: string;
	calls: number;
	errors: number;
	p50_ms: number | null;
	p95_ms: number | null;
}
export interface UsageHealth {
	d1_bytes: number;
	vector_backlog: number;
	cron_last_run_at: number | null;
}
export interface UsageResponse {
	daily: UsageDaily[];
	health: UsageHealth;
}
export interface UsageFilters {
	key_id: string;
	from: string;
	to: string;
}
export interface AuditFilters {
	actor: string;
	route: string;
	status: string;
	from: string;
	to: string;
}
export interface AuditRow {
	id: string;
	at: number;
	actor: string;
	method: string;
	route: string;
	status: number;
	error_code: string | null;
	request_id: string;
	duration_ms: number;
}
interface AuditResponse {
	items: AuditRow[];
	next_cursor: string | null;
}

function dateFilter(value: string | null): string {
	return value && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value))
		? value
		: "";
}
export function parseUsageFilters(search = ""): UsageFilters {
	const params = new URLSearchParams(search);
	return {
		key_id: params.get("key_id")?.trim() ?? "",
		from: dateFilter(params.get("from")),
		to: dateFilter(params.get("to")),
	};
}
export function parseAuditFilters(search = ""): AuditFilters {
	const params = new URLSearchParams(search);
	const status = params.get("status") ?? "";
	return {
		actor: params.get("actor")?.trim() ?? "",
		route: params.get("route")?.trim() ?? "",
		status: /^[1-5]\d\d$/.test(status) ? status : "",
		from: dateFilter(params.get("from")),
		to: dateFilter(params.get("to")),
	};
}
function query(filters: UsageFilters | AuditFilters): string {
	return new URLSearchParams(
		Object.entries(filters).filter(([, value]) => value !== ""),
	).toString();
}
export const auditQuery = (filters: AuditFilters): string => query(filters);
export const usageQuery = (filters: UsageFilters): string => query(filters);
function reversed(filters: { from: string; to: string }): boolean {
	return Boolean(filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to));
}
function endpoint(path: string, search: string): string {
	return search ? `${path}?${search}` : path;
}

export class UsageModel extends Store<
	UsageResponse & { filters: UsageFilters; loading: boolean; loaded: boolean; error: string | null }
> {
	private revision = 0;
	constructor(private readonly api: AdminClient = adminApi) {
		super({
			daily: [],
			health: { d1_bytes: 0, vector_backlog: 0, cron_last_run_at: null },
			filters: parseUsageFilters(),
			loading: false,
			loaded: false,
			error: null,
		});
	}
	get rows(): Array<UsageDaily & { error_rate: number }> {
		return this.state.daily.map((row) => ({
			...row,
			error_rate: row.calls > 0 ? (row.errors / row.calls) * 100 : 0,
		}));
	}
	get chart(): Array<{
		x: string;
		calls: number;
		error_rate: number;
		p50_ms: number | null;
		p95_ms: number | null;
	}> {
		return this.rows.map((row) => ({
			x: `${row.day} / ${row.key_id}`,
			calls: row.calls,
			error_rate: row.error_rate,
			p50_ms: row.p50_ms,
			p95_ms: row.p95_ms,
		}));
	}
	async load(search = ""): Promise<void> {
		const filters = parseUsageFilters(search);
		const revision = ++this.revision;
		if (reversed(filters)) {
			this.set({
				filters,
				daily: [],
				error: "Start time must not follow end time.",
				loading: false,
			});
			return;
		}
		const changed = usageQuery(filters) !== usageQuery(this.state.filters);
		this.set({ filters, daily: changed ? [] : this.state.daily, loading: true, error: null });
		try {
			const result = await this.api.request<UsageResponse>(endpoint("/usage", usageQuery(filters)));
			if (revision === this.revision)
				this.set({ daily: result.daily, health: result.health, loading: false, loaded: true });
		} catch {
			if (revision === this.revision)
				this.set({ error: "Unable to load usage and health.", loading: false });
		}
	}
	dispose(): void {
		this.revision++;
	}
}

export function virtualWindow(
	count: number,
	scrollTop: number,
	height: number,
	rowHeight: number,
): { start: number; end: number; before: number; after: number } {
	const size = Math.max(1, rowHeight);
	const start = Math.min(count, Math.max(0, Math.floor(scrollTop / size) - 5));
	const end = Math.min(
		count,
		Math.max(start, Math.ceil((Math.max(0, scrollTop) + height) / size) + 5),
	);
	return { start, end, before: start * size, after: (count - end) * size };
}

function csvCell(value: string | number | null): string {
	const text = String(value ?? "");
	const safe = /^[\t\r\n]|^\s*[=+\-@]/.test(text) ? `'${text}` : text;
	return `"${safe.replaceAll('"', '""')}"`;
}
export function auditCsv(rows: AuditRow[]): string {
	const columns = [
		"id",
		"at",
		"actor",
		"method",
		"route",
		"status",
		"error_code",
		"request_id",
		"duration_ms",
	] as const;
	return [
		columns.map(csvCell).join(","),
		...rows.map((row) =>
			columns
				.map((column) => csvCell(column === "at" ? new Date(row.at).toISOString() : row[column]))
				.join(","),
		),
	].join("\r\n");
}

function auditPath(filters: AuditFilters, cursor: string | null): string {
	const params = new URLSearchParams(auditQuery(filters));
	params.set("limit", "200");
	if (cursor) params.set("cursor", cursor);
	return `/audit?${params}`;
}

export class AuditModel extends Store<{
	items: AuditRow[];
	filters: AuditFilters;
	nextCursor: string | null;
	loading: boolean;
	loadingMore: boolean;
	exporting: boolean;
	error: string | null;
}> {
	private revision = 0;
	constructor(private readonly api: AdminClient = adminApi) {
		super({
			items: [],
			filters: parseAuditFilters(),
			nextCursor: null,
			loading: false,
			loadingMore: false,
			exporting: false,
			error: null,
		});
	}
	async load(search = ""): Promise<void> {
		const filters = parseAuditFilters(search);
		const revision = ++this.revision;
		if (reversed(filters)) {
			this.set({
				filters,
				items: [],
				nextCursor: null,
				loadingMore: false,
				error: "Start time must not follow end time.",
				loading: false,
			});
			return;
		}
		const changed = auditQuery(filters) !== auditQuery(this.state.filters);
		this.set({
			filters,
			items: changed ? [] : this.state.items,
			nextCursor: null,
			loading: true,
			loadingMore: false,
			error: null,
		});
		try {
			const result = await this.api.request<AuditResponse>(auditPath(filters, null));
			if (revision === this.revision)
				this.set({ items: result.items, nextCursor: result.next_cursor, loading: false });
		} catch {
			if (revision === this.revision)
				this.set({ error: "Unable to load audit log.", loading: false });
		}
	}
	async loadMore(): Promise<void> {
		if (this.state.loading || this.state.loadingMore || !this.state.nextCursor) return;
		const revision = this.revision;
		this.set({ loadingMore: true, error: null });
		try {
			const result = await this.api.request<AuditResponse>(
				auditPath(this.state.filters, this.state.nextCursor),
			);
			if (revision === this.revision) {
				const rows = new Map(this.state.items.map((row) => [row.id, row]));
				for (const row of result.items) rows.set(row.id, row);
				this.set({ items: [...rows.values()], nextCursor: result.next_cursor, loadingMore: false });
			}
		} catch {
			if (revision === this.revision)
				this.set({ error: "Unable to load audit log.", loadingMore: false });
		}
	}
	async exportCsv(): Promise<string | null> {
		if (this.state.exporting) return null;
		if (reversed(this.state.filters)) {
			this.set({ error: "Start time must not follow end time." });
			return null;
		}
		const revision = this.revision;
		const filters = this.state.filters;
		this.set({ exporting: true, error: null });
		try {
			let cursor: string | null = null;
			const seen = new Set<string>();
			const rows: AuditRow[] = [];
			do {
				const result: AuditResponse = await this.api.request<AuditResponse>(
					auditPath(filters, cursor),
				);
				if (revision !== this.revision) return null;
				rows.push(...result.items);
				cursor = result.next_cursor;
				if (cursor) {
					if (seen.has(cursor)) throw new Error("Repeated audit cursor");
					seen.add(cursor);
				}
			} while (cursor);
			return auditCsv(rows);
		} catch {
			if (revision === this.revision) this.set({ error: "Unable to export audit log." });
			return null;
		} finally {
			this.set({ exporting: false });
		}
	}
	dispose(): void {
		this.revision++;
		this.set({ loading: false, loadingMore: false, exporting: false });
	}
}
