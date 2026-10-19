import { type AdminClient, ApiError, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import {
	type LibraryMemory,
	type LibrarySpace,
	libraryError,
	selectedIds,
	setSelection,
} from "./library";

export interface TrashFilters {
	q?: string;
	space?: string;
}
export interface TrashSelection {
	ids: string[];
	all: boolean;
	excluded: string[];
}
export interface TrashPageResult {
	items: LibraryMemory[];
	total: number;
	next_cursor: string | null;
}
interface ItemResult {
	id: string;
	ok: boolean;
	error?: { code: string };
}
interface EmptyResult {
	results: ItemResult[];
	purged: number;
	remaining: number;
	next_cursor: string | null;
}
export interface TrashConfirmation {
	kind: "single" | "purge" | "empty";
	count: number;
	filters: TrashFilters;
	ids: string[];
	title?: string;
	stage: "title" | "confirm";
}
export interface TrashState {
	loading: boolean;
	preparing: boolean;
	busy: boolean;
	ready: boolean;
	error: string | null;
	spacesError: string | null;
	notice: string | null;
	memories: LibraryMemory[];
	spaces: Pick<LibrarySpace, "slug" | "name">[];
	total: number;
	page: number;
	nextCursor: string | null;
	filters: TrashFilters;
	confirmation: TrashConfirmation | null;
	progress: { processed: number; total: number } | null;
	succeeded: string[];
	purged: number;
	failures: { id: string; message: string }[];
}

const scopeChanged = "回收站数量或筛选范围已变化，请刷新后重新确认。";
const invalidSelection = "请选择当前筛选范围内的记忆。";

export function readTrashFilters(params: URLSearchParams): TrashFilters {
	const q = params.get("q")?.trim();
	const space = params.get("space")?.trim();
	return { ...(q ? { q } : {}), ...(space ? { space } : {}) };
}
export function readTrashSelection(params: URLSearchParams): TrashSelection {
	return {
		ids: selectedIds(params),
		all: params.get("all") === "1",
		excluded: [...new Set(params.getAll("excluded").filter(Boolean))],
	};
}
export function setTrashFilter(
	params: URLSearchParams,
	key: "q" | "space",
	value: string,
): URLSearchParams {
	const next = setSelection(params, []);
	next.delete("all");
	next.delete("excluded");
	if (value) next.set(key, value);
	else next.delete(key);
	return next;
}
export function selectAllTrash(params: URLSearchParams): URLSearchParams {
	const next = setSelection(params, []);
	next.delete("excluded");
	next.set("all", "1");
	return next;
}
export function setTrashPageSelection(
	params: URLSearchParams,
	ids: string[],
	checked: boolean,
): URLSearchParams {
	const selection = readTrashSelection(params);
	if (selection.all) {
		const next = new URLSearchParams(params);
		const excluded = new Set(selection.excluded);
		for (const id of ids) checked ? excluded.delete(id) : excluded.add(id);
		next.delete("excluded");
		for (const id of excluded) next.append("excluded", id);
		return next;
	}
	const selected = new Set(selection.ids);
	for (const id of ids) checked ? selected.add(id) : selected.delete(id);
	return setSelection(params, [...selected]);
}
export function trashScope(filters: TrashFilters): string {
	return [
		filters.space ? `空间「${filters.space}」` : "全部空间",
		filters.q ? `标题或标签包含「${filters.q}」` : "不限关键词",
	].join("，");
}

export class TrashModel extends Store<TrashState> {
	private generation = 0;
	private controller = new AbortController();
	private spacesController = new AbortController();
	private cursors: (string | null)[] = [null];
	private knownIds = new Set<string>();
	private selectionKey = "";

	constructor(private readonly api: AdminClient = adminApi) {
		super({
			loading: false,
			preparing: false,
			busy: false,
			ready: false,
			error: null,
			spacesError: null,
			notice: null,
			memories: [],
			spaces: [],
			total: 0,
			page: 1,
			nextCursor: null,
			filters: {},
			confirmation: null,
			progress: null,
			succeeded: [],
			purged: 0,
			failures: [],
		});
	}

	private error(error: unknown): string {
		return error instanceof Error &&
			[
				scopeChanged,
				invalidSelection,
				"分页游标重复，已停止加载。",
				"处理进度异常，已停止操作，请刷新后重新确认。",
			].includes(error.message)
			? error.message
			: libraryError(error);
	}
	private active(generation: number): void {
		if (generation !== this.generation) throw new DOMException("Obsolete request", "AbortError");
	}
	private list(filters: TrashFilters, cursor: string | null, limit = 25): Promise<TrashPageResult> {
		const query = new URLSearchParams({ limit: String(limit), ...filters });
		if (cursor) query.set("cursor", cursor);
		return this.api.request(`/trash?${query}`, { signal: this.controller.signal });
	}
	private async readPage(page: number, generation: number): Promise<void> {
		const result = await this.list(this.state.filters, this.cursors[page - 1] ?? null);
		this.active(generation);
		if (result.next_cursor && this.cursors.slice(0, page).includes(result.next_cursor))
			throw new Error("分页游标重复，已停止加载。");
		this.cursors = [...this.cursors.slice(0, page), result.next_cursor];
		for (const item of result.items) this.knownIds.add(item.id);
		this.set({
			memories: result.items,
			total: result.total,
			nextCursor: result.next_cursor,
			page,
			ready: true,
		});
	}
	async load(filters: TrashFilters = this.state.filters): Promise<boolean> {
		if (this.state.busy) return false;
		this.controller.abort();
		this.controller = new AbortController();
		const generation = ++this.generation;
		const changed = JSON.stringify(filters) !== JSON.stringify(this.state.filters);
		this.cursors = [null];
		this.knownIds.clear();
		this.set({
			filters: { ...filters },
			loading: true,
			preparing: false,
			error: null,
			confirmation: null,
			...(changed
				? {
						ready: false,
						memories: [],
						total: 0,
						notice: null,
						failures: [],
						succeeded: [],
						progress: null,
					}
				: {}),
		});
		try {
			await this.readPage(1, generation);
			return true;
		} catch (error) {
			if (generation === this.generation) this.set({ error: this.error(error) });
			return false;
		} finally {
			if (generation === this.generation) this.set({ loading: false });
		}
	}
	async loadSpaces(): Promise<void> {
		this.spacesController.abort();
		const controller = new AbortController();
		this.spacesController = controller;
		try {
			const result = await this.api.request<{ items: TrashState["spaces"] }>("/spaces", {
				signal: controller.signal,
			});
			if (!controller.signal.aborted) this.set({ spaces: result.items, spacesError: null });
		} catch (error) {
			if (!controller.signal.aborted) this.set({ spacesError: this.error(error) });
		}
	}
	private async navigate(page: number): Promise<boolean> {
		if (this.locked || page < 1 || (page > 1 && !this.cursors[page - 1])) return false;
		const generation = this.generation;
		this.set({ loading: true, error: null });
		try {
			await this.readPage(page, generation);
			return true;
		} catch (error) {
			if (generation === this.generation) this.set({ error: this.error(error) });
			return false;
		} finally {
			if (generation === this.generation) this.set({ loading: false });
		}
	}
	nextPage(): Promise<boolean> {
		return this.navigate(this.state.page + 1);
	}
	previousPage(): Promise<boolean> {
		return this.navigate(this.state.page - 1);
	}
	get locked(): boolean {
		return this.state.busy || this.state.loading || this.state.preparing;
	}
	dispose(): void {
		this.generation++;
		this.controller.abort();
		this.spacesController.abort();
	}

	private async resolveIds(selection: TrashSelection, generation: number): Promise<string[]> {
		const requested = [...new Set(selection.ids)];
		if (!selection.all && requested.length && requested.every((id) => this.knownIds.has(id)))
			return requested;
		if (!selection.all && !requested.length) throw new Error(invalidSelection);
		const total = this.state.total;
		const ids = new Set<string>();
		const seen = new Set<string>();
		let cursor: string | null = null;
		do {
			const result = await this.list(this.state.filters, cursor, 200);
			this.active(generation);
			if (result.total !== total) throw new Error(scopeChanged);
			for (const item of result.items) {
				if (ids.has(item.id)) throw new Error(scopeChanged);
				ids.add(item.id);
			}
			cursor = result.next_cursor;
			if (cursor && (seen.has(cursor) || ids.size >= total || result.items.length === 0))
				throw new Error(scopeChanged);
			if (cursor) seen.add(cursor);
		} while (cursor);
		if (ids.size !== total) throw new Error(scopeChanged);
		const selected = selection.all
			? [...ids].filter((id) => !selection.excluded.includes(id))
			: requested;
		if (!selected.length || selected.some((id) => !ids.has(id))) throw new Error(invalidSelection);
		return selected;
	}
	async preparePurge(selection: TrashSelection): Promise<boolean> {
		if (this.locked || !this.state.ready) return false;
		const generation = this.generation;
		this.set({ preparing: true, error: null, confirmation: null });
		try {
			const ids = await this.resolveIds(selection, generation);
			this.active(generation);
			this.set({
				confirmation: {
					kind: "purge",
					ids,
					count: ids.length,
					filters: { ...this.state.filters },
					stage: "confirm",
				},
			});
			return true;
		} catch (error) {
			if (generation === this.generation)
				this.set({
					error:
						error instanceof ApiError && error.status === 409 ? scopeChanged : this.error(error),
				});
			return false;
		} finally {
			if (generation === this.generation) this.set({ preparing: false });
		}
	}
	prepareEmpty(): boolean {
		if (this.locked || !this.state.ready || !this.state.total) return false;
		this.set({
			error: null,
			confirmation: {
				kind: "empty",
				ids: [],
				count: this.state.total,
				filters: { ...this.state.filters },
				stage: "confirm",
			},
		});
		return true;
	}
	beginPurge(id: string): boolean {
		const item = this.state.memories.find((memory) => memory.id === id);
		if (this.locked || !item) return false;
		this.set({
			error: null,
			confirmation: {
				kind: "single",
				ids: [id],
				title: item.title,
				count: 1,
				filters: { ...this.state.filters },
				stage: "title",
			},
		});
		return true;
	}
	confirmTitle(title: string): boolean {
		const confirmation = this.state.confirmation;
		if (this.locked || confirmation?.kind !== "single" || confirmation.title !== title)
			return false;
		this.set({ confirmation: { ...confirmation, stage: "confirm" } });
		return true;
	}
	cancelConfirmation(): void {
		if (!this.state.busy)
			this.set({
				confirmation: null,
				...(this.state.confirmation?.kind === "single" ? { error: null } : {}),
			});
	}
	selectionChanged(key: string): void {
		if (key === this.selectionKey) return;
		this.selectionKey = key;
		if (this.state.busy) return;
		if (this.state.preparing) {
			this.generation++;
			this.controller.abort();
			this.controller = new AbortController();
		}
		this.set({ preparing: false, confirmation: null });
	}

	private record(ids: string[], results: ItemResult[]): void {
		const succeeded = [...this.state.succeeded];
		const failures = [...this.state.failures];
		for (const id of ids) {
			const item = results.find((result) => result.id === id);
			if (item?.ok) succeeded.push(id);
			else
				failures.push({
					id,
					message: item?.error
						? libraryError(new ApiError(0, item.error.code))
						: "未收到这条记忆的处理结果。",
				});
		}
		this.set({
			succeeded,
			failures,
			progress: {
				processed: succeeded.length + failures.length,
				total: this.state.progress?.total ?? ids.length,
			},
		});
	}
	private async batch(kind: "Restore" | "Purge", ids: string[], generation: number): Promise<void> {
		this.set({ progress: { processed: 0, total: ids.length } });
		for (let start = 0; start < ids.length; start += 100) {
			this.active(generation);
			const chunk = ids.slice(start, start + 100);
			try {
				const response = await this.api.request<{ results: ItemResult[] }>(`/trash:batch${kind}`, {
					method: "POST",
					json: { ids: chunk },
				});
				this.active(generation);
				this.record(chunk, response.results);
			} catch (error) {
				if (generation === this.generation)
					this.set({
						failures: [
							...this.state.failures,
							...ids.slice(start).map((id) => ({ id, message: "未确认处理结果，请刷新后重试。" })),
						],
					});
				throw error;
			}
		}
	}
	private async empty(confirmation: TrashConfirmation, generation: number): Promise<void> {
		let cursor: string | null = null;
		let remaining = confirmation.count;
		const seen = new Set<string>();
		const seenIds = new Set<string>();
		do {
			this.active(generation);
			const response: EmptyResult = await this.api.request("/trash:empty", {
				method: "POST",
				json: {
					filters: confirmation.filters,
					expected_count: confirmation.count,
					...(cursor ? { cursor } : {}),
				},
			});
			this.active(generation);
			const ids = response.results.map((item) => item.id);
			if (
				!Number.isSafeInteger(response.purged) ||
				!Number.isSafeInteger(response.remaining) ||
				response.purged < 0 ||
				response.purged > response.results.filter((item) => item.ok).length ||
				response.remaining < 0 ||
				response.remaining > remaining ||
				ids.length > 100 ||
				new Set(ids).size !== ids.length ||
				ids.some((id) => seenIds.has(id)) ||
				seenIds.size + ids.length > confirmation.count
			)
				throw new Error("处理进度异常，已停止操作，请刷新后重新确认。");
			for (const id of ids) seenIds.add(id);
			this.record(ids, response.results);
			this.set({ purged: this.state.purged + response.purged });
			const failed = response.results.some((item) => !item.ok);
			if (
				(response.next_cursor &&
					(response.results.length === 0 || seen.has(response.next_cursor))) ||
				(!response.next_cursor && response.remaining !== 0 && !failed)
			)
				throw new Error("处理进度异常，已停止操作，请刷新后重新确认。");
			if (failed) return;
			remaining = response.remaining;
			cursor = response.next_cursor;
			if (cursor) seen.add(cursor);
		} while (cursor);
	}
	private async mutate(
		action: (generation: number) => Promise<void>,
		label: string,
		total: number,
		scoped = false,
	): Promise<boolean> {
		if (this.locked || !this.state.ready) return false;
		const generation = this.generation;
		this.set({
			busy: true,
			error: null,
			notice: null,
			succeeded: [],
			failures: [],
			progress: { processed: 0, total },
			purged: 0,
		});
		let ok = true;
		try {
			await action(generation);
			this.active(generation);
		} catch (error) {
			ok = false;
			if (generation === this.generation)
				this.set({
					error:
						scoped && error instanceof ApiError && error.status === 409
							? scopeChanged
							: this.error(error),
				});
		} finally {
			if (generation === this.generation && (ok || this.state.confirmation?.kind !== "single")) {
				const succeeded =
					this.state.confirmation?.kind === "empty"
						? this.state.purged
						: this.state.succeeded.length;
				this.set({
					confirmation: null,
					notice: `已${label} ${succeeded} / ${this.state.progress?.total ?? total} 条记忆`,
				});
				this.cursors = [null];
				this.knownIds.clear();
				try {
					await this.readPage(1, generation);
				} catch (error) {
					if (generation === this.generation && !this.state.error)
						this.set({ error: `操作结果已保留，但刷新失败：${this.error(error)}` });
				}
			}
			if (generation === this.generation) this.set({ busy: false });
		}
		return ok;
	}
	restore(selection: TrashSelection): Promise<boolean> {
		return this.mutate(
			async (generation) => {
				const ids = await this.resolveIds(selection, generation);
				await this.batch("Restore", ids, generation);
			},
			"恢复",
			selection.all
				? Math.max(0, this.state.total - selection.excluded.length)
				: new Set(selection.ids).size,
			selection.all,
		);
	}
	confirm(): Promise<boolean> {
		const confirmation = this.state.confirmation;
		if (confirmation?.stage !== "confirm") return Promise.resolve(false);
		return this.mutate(
			async (generation) => {
				if (confirmation.kind === "empty") await this.empty(confirmation, generation);
				else if (confirmation.kind === "purge")
					await this.batch("Purge", confirmation.ids, generation);
				else {
					await this.api.request(`/trash/${encodeURIComponent(confirmation.ids[0] as string)}`, {
						method: "DELETE",
					});
					this.active(generation);
					this.record(
						confirmation.ids,
						confirmation.ids.map((id) => ({ id, ok: true })),
					);
				}
			},
			"彻底删除",
			confirmation.count,
			confirmation.kind === "empty",
		);
	}
}
