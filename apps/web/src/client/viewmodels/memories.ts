import type { MemoryFilters } from "../../lib/schema/filters";
import { memoryFiltersSchema } from "../../lib/schema/filters";
import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";

export interface Attachment {
	id: string;
	memory_id: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	sha256: string;
	created_at: string;
	markdown?: string;
}

export interface Memory {
	id: string;
	space: string;
	title: string;
	body: string;
	type: string;
	tags: string[];
	importance: number;
	event_time: string | null;
	version: number;
	content_hash: string;
	source_key_id: string | null;
	updated_by_key_id: string | null;
	created_at: string;
	updated_at: string;
	attachments?: Attachment[];
	versions_count?: number;
	vector_status?: unknown;
}

export interface MemoryVersion {
	memory_id: string;
	version: number;
	title: string;
	body?: string;
	type: string;
	importance: number;
	tags: string[];
	event_time: string | null;
	space_id: string;
	actor: string;
	op: string;
	rollback_of: number | null;
	created_at: string;
}

export interface MemoryDiff {
	from: number;
	to: number;
	fields: { field: string; from: unknown; to: unknown }[];
	body: {
		unified: string;
		hunks: {
			oldStart: number;
			oldLines: number;
			newStart: number;
			newLines: number;
			lines: string[];
		}[];
	};
}

export const filterKeys = [
	"spaces",
	"tags_all",
	"tags_any",
	"types",
	"sources",
	"time_field",
	"time_from",
	"time_to",
	"importance_min",
	"importance_max",
] as const;

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "request_failed";
}

export function filtersFromUrl(params: URLSearchParams): MemoryFilters {
	const raw: Record<string, unknown> = {};
	for (const key of ["spaces", "tags_all", "tags_any", "types", "sources"]) {
		const items = (params.get(key) ?? "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		if (items.length) raw[key] = items;
	}
	const from = params.get("time_from");
	const to = params.get("time_to");
	const field = params.get("time_field");
	if (field || from || to)
		raw.time = { field: field || "updated", ...(from ? { from } : {}), ...(to ? { to } : {}) };
	const min = params.get("importance_min");
	const max = params.get("importance_max");
	if (min || max)
		raw.importance = { ...(min ? { min: Number(min) } : {}), ...(max ? { max: Number(max) } : {}) };
	const filters = memoryFiltersSchema.parse(raw);
	if (
		filters.importance?.min !== undefined &&
		filters.importance.max !== undefined &&
		filters.importance.min > filters.importance.max
	)
		throw new Error("Minimum importance exceeds maximum");
	if (
		filters.time?.from &&
		filters.time.to &&
		Date.parse(filters.time.from) > Date.parse(filters.time.to)
	)
		throw new Error("Start time exceeds end time");
	return filters;
}

export function pageLimit(params: URLSearchParams): number {
	const limit = Number(params.get("limit") ?? 50);
	if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Limit must be 1–200");
	return limit;
}

export function memoryQuery(params: URLSearchParams): string {
	const filters = filtersFromUrl(params);
	const query = new URLSearchParams();
	for (const key of filterKeys) {
		const value = params.get(key);
		if (value) query.set(key, value);
	}
	if (filters.time) query.set("time_field", filters.time.field);
	query.set("limit", String(pageLimit(params)));
	const cursor = params.get("cursor");
	if (cursor) query.set("cursor", cursor);
	return query.toString();
}

export class MemoriesModel extends Store<{
	items: Memory[];
	nextCursor: string | null;
	loading: boolean;
	error: string | null;
}> {
	private generation = 0;
	private cache = new Map<string, { items: Memory[]; next_cursor: string | null }>();
	constructor(private readonly api: AdminClient = adminApi) {
		super({ items: [], nextCursor: null, loading: false, error: null });
	}
	async load(params: URLSearchParams): Promise<void> {
		const generation = ++this.generation;
		try {
			const query = memoryQuery(params);
			const cached = this.cache.get(query);
			this.set({
				items: cached?.items ?? [],
				nextCursor: cached?.next_cursor ?? null,
				loading: true,
				error: null,
			});
			const result = await this.api.request<{ items: Memory[]; next_cursor: string | null }>(
				`/memories?${query}`,
			);
			this.cache.set(query, result);
			if (generation === this.generation)
				this.set({ items: result.items, nextCursor: result.next_cursor, loading: false });
		} catch (error) {
			if (generation === this.generation) this.set({ loading: false, error: errorMessage(error) });
		}
	}
}

export function attachmentIds(body: string): string[] {
	return [
		...new Set(
			[...body.matchAll(/octo:\/\/att\/([A-Za-z0-9_-]+)/g)].map((match) => match[1] as string),
		),
	];
}

export class MemoryModel extends Store<{
	memory: Memory | null;
	versions: MemoryVersion[];
	urls: Record<string, string>;
	loading: boolean;
	error: string | null;
}> {
	private generation = 0;
	private signed = new Map<string, { url: string; expires_at: string }>();
	constructor(
		readonly id: string,
		private readonly api: AdminClient = adminApi,
		private readonly now: () => number = Date.now,
	) {
		super({ memory: null, versions: [], urls: {}, loading: false, error: null });
	}
	async load(): Promise<void> {
		const generation = ++this.generation;
		this.set({ loading: true, error: null });
		try {
			const [memory, versions] = await Promise.all([
				this.api.request<Memory>(
					`/memories/${encodeURIComponent(this.id)}?include=versions_count,attachments,vector_status`,
				),
				this.api.request<{ items: MemoryVersion[] }>(
					`/memories/${encodeURIComponent(this.id)}/versions`,
				),
			]);
			if (generation !== this.generation) return;
			this.set({ memory, versions: versions.items });
			await Promise.all(
				[
					...new Set([
						...(memory.attachments ?? []).map((item) => item.id),
						...attachmentIds(memory.body),
					]),
				].map((id) => this.attachmentUrl(id)),
			);
		} catch (error) {
			if (generation === this.generation) this.set({ error: errorMessage(error) });
		} finally {
			if (generation === this.generation) this.set({ loading: false });
		}
	}
	async attachmentUrl(id: string): Promise<string> {
		let signed = this.signed.get(id);
		if (!signed || Date.parse(signed.expires_at) <= this.now() + 30_000) {
			signed = await this.api.request<{ url: string; expires_at: string }>(
				`/attachments/${encodeURIComponent(id)}/url`,
			);
			this.signed.set(id, signed);
		}
		this.set({ urls: { ...this.state.urls, [id]: signed.url } });
		return signed.url;
	}
}

export class HistoryModel extends Store<{
	current: Memory | null;
	versions: MemoryVersion[];
	diff: MemoryDiff | null;
	loading: boolean;
	error: string | null;
	rollbackTarget: number | null;
	saving: boolean;
	notice: string | null;
}> {
	private generation = 0;
	private comparison = 0;
	constructor(
		readonly id: string,
		private readonly api: AdminClient = adminApi,
	) {
		super({
			current: null,
			versions: [],
			diff: null,
			loading: false,
			error: null,
			rollbackTarget: null,
			saving: false,
			notice: null,
		});
	}
	loadFromUrl(params: URLSearchParams): Promise<void> {
		return this.load(
			params.has("from") ? Number(params.get("from")) : undefined,
			params.has("to") ? Number(params.get("to")) : undefined,
		);
	}
	async load(from?: number, to?: number): Promise<void> {
		const generation = ++this.generation;
		++this.comparison;
		this.set({ loading: true, error: null });
		try {
			const [current, versions] = await Promise.all([
				this.api.request<Memory>(`/memories/${encodeURIComponent(this.id)}`),
				this.api.request<{ items: MemoryVersion[] }>(
					`/memories/${encodeURIComponent(this.id)}/versions`,
				),
			]);
			if (generation !== this.generation) return;
			this.set({ current, versions: versions.items, diff: null });
			if (from !== undefined && to !== undefined) await this.compare(from, to);
		} catch (error) {
			if (generation === this.generation) this.set({ error: errorMessage(error) });
		} finally {
			if (generation === this.generation) this.set({ loading: false });
		}
	}
	async compare(from: number, to: number): Promise<void> {
		const comparison = ++this.comparison;
		this.set({ loading: true, error: null });
		try {
			const diff = await this.api.request<MemoryDiff>(
				`/memories/${encodeURIComponent(this.id)}/diff?from=${from}&to=${to}`,
			);
			if (comparison === this.comparison) this.set({ diff, loading: false });
		} catch (error) {
			if (comparison === this.comparison) this.set({ error: errorMessage(error), loading: false });
		}
	}
	requestRollback(version: number): void {
		this.set({ rollbackTarget: version });
	}
	cancelRollback(): void {
		this.set({ rollbackTarget: null });
	}
	async rollback(): Promise<void> {
		if (!this.state.current || this.state.rollbackTarget === null || this.state.saving) return;
		this.set({ saving: true, error: null, notice: null });
		try {
			const current = await this.api.request<Memory>(
				`/memories/${encodeURIComponent(this.id)}/rollback`,
				{
					method: "POST",
					json: { to_version: this.state.rollbackTarget },
					headers: { "If-Match": String(this.state.current.version) },
				},
			);
			this.set({
				current,
				rollbackTarget: null,
				notice: `Rollback created version ${current.version}`,
			});
			await this.load();
		} catch (error) {
			this.set({ error: errorMessage(error) });
		} finally {
			this.set({ saving: false });
		}
	}
}
