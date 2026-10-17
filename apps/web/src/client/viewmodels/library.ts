import { type AdminClient, ApiError, adminApi } from "../lib/api";
import { Store } from "../lib/store";

export interface LibraryMemory {
	id: string;
	title: string;
	space: string;
	tags: string[];
	version: number;
	created_at: string;
	event_time: string | null;
	deleted_at?: string;
}
export interface LibraryTag {
	id: string;
	name: string;
	display_name: string;
	use_count: number;
}
export interface LibrarySpace {
	id: string;
	slug: string;
	name: string;
	description: string;
	owner_key_id: string | null;
	memory_count: number;
}
export interface LibraryKey {
	id: string;
	name: string;
}
export interface ListPage<T> {
	items: T[];
	next_cursor: string | null;
}
export type LibraryKind = "tags" | "spaces" | "trash" | "graph" | "timeline";
export interface LibraryState {
	busy: boolean;
	ready: boolean;
	error: string | null;
	notice: string | null;
	memories: LibraryMemory[];
	tags: LibraryTag[];
	spaces: LibrarySpace[];
	keys: LibraryKey[];
	truncated: boolean;
	nextCursor: string | null;
	failures: { id: string; message: string }[];
	purge: { id: string; title: string; stage: "title" | "confirm" } | null;
}

export function selectedIds(params: URLSearchParams): string[] {
	return [...new Set(params.getAll("selected").filter(Boolean))];
}

export function setSelection(params: URLSearchParams, ids: string[]): URLSearchParams {
	const next = new URLSearchParams(params);
	next.delete("selected");
	for (const id of new Set(ids)) next.append("selected", id);
	return next;
}

const libraryMessages = new Map<string, string>([
	["access_denied", "没有访问权限，请重新登录或联系管理员。"],
	["unauthenticated", "登录已失效，请重新登录。"],
	["forbidden", "没有执行此操作的权限。"],
	["not_found", "内容不存在或已被删除，请刷新后重试。"],
	["version_conflict", "内容已被修改，请刷新后重试。"],
	["tag_conflict", "标签已存在，请选择其他名称。"],
	["idempotency_conflict", "请求与之前的操作冲突，请刷新后重试。"],
	["validation_failed", "提交内容有误，请检查后重试。"],
	["vector_dimension_mismatch", "向量维度不匹配，请检查嵌入设置。"],
	["payload_too_large", "提交内容过大，请减少内容后重试。"],
	["unsupported_media_type", "不支持此文件类型。"],
	["unprocessable", "无法处理此内容，请检查后重试。"],
	["unavailable", "服务暂时不可用，请稍后重试。"],
	["internal", "服务暂时异常，请稍后重试。"],
	["pagination_cycle", "分页游标重复，已停止加载。"],
	["invalid_tag_target", "请选择来源标签和另一个有效的目标标签。"],
	["missing_space_name", "请填写空间标识和名称。"],
	["invalid_selection", "请选择 1 至 100 条可用的记忆。"],
	["purge_confirmation_required", "请先输入标题并确认永久删除。"],
	["missing_destination", "请选择目标空间。"],
	["empty_tags", "请输入非空标签。"],
	["missing_batch_result", "未收到这条记忆的处理结果。"],
]);

export function libraryError(error: unknown): string {
	const fallback = "请求失败，请稍后重试。";
	if (!(error instanceof Error)) return fallback;
	if (error instanceof ApiError) return libraryMessages.get(error.code) ?? fallback;
	return (
		libraryMessages.get(error.message) ??
		([...libraryMessages.values()].includes(error.message) ? error.message : fallback)
	);
}

export class LibraryModel extends Store<LibraryState> {
	private trashCursors = new Set<string>();

	constructor(
		readonly kind: LibraryKind,
		private readonly api: AdminClient = adminApi,
	) {
		super({
			busy: false,
			ready: false,
			error: null,
			notice: null,
			memories: [],
			tags: [],
			spaces: [],
			keys: [],
			truncated: false,
			nextCursor: null,
			failures: [],
			purge: null,
		});
	}

	private async run(action: () => Promise<void>): Promise<boolean> {
		if (this.state.busy) return false;
		this.set({ busy: true, error: null });
		try {
			await action();
			return true;
		} catch (error) {
			this.set({ error: libraryError(error) });
			return false;
		} finally {
			this.set({ busy: false });
		}
	}

	private async read(): Promise<void> {
		if (this.kind === "trash") {
			await this.readTrash(null);
			return;
		}
		if (this.kind === "spaces") {
			const spaces = await this.api.request<ListPage<LibrarySpace>>("/spaces");
			const keys = await this.api.request<ListPage<LibraryKey>>("/keys");
			this.set({ spaces: spaces.items, keys: keys.items, ready: true });
			return;
		}
		const tags =
			this.kind === "tags"
				? (await this.api.request<ListPage<LibraryTag>>("/tags")).items
				: this.state.tags;
		const memories: LibraryMemory[] = [];
		const seen = new Set<string>();
		let cursor: string | null = null;
		do {
			const query = new URLSearchParams({ limit: "200" });
			if (cursor) query.set("cursor", cursor);
			const page: ListPage<LibraryMemory> = await this.api.request(`/memories?${query}`);
			memories.push(...page.items);
			cursor = page.next_cursor;
			if (cursor && seen.has(cursor)) throw new Error("分页游标重复，已停止加载。");
			if (cursor) seen.add(cursor);
		} while (cursor && memories.length < 2000);
		this.set({ memories, tags, ready: true, truncated: cursor !== null });
	}

	load(): Promise<boolean> {
		return this.run(() => this.read());
	}

	private async readTrash(cursor: string | null): Promise<void> {
		const query = new URLSearchParams({ limit: "200" });
		if (cursor) query.set("cursor", cursor);
		const page = await this.api.request<ListPage<LibraryMemory>>(`/trash?${query}`);
		const seen = cursor ? new Set(this.trashCursors) : new Set<string>();
		if (page.next_cursor && seen.has(page.next_cursor))
			throw new Error("分页游标重复，已停止加载。");
		if (page.next_cursor) seen.add(page.next_cursor);
		const memories = new Map((cursor ? this.state.memories : []).map((item) => [item.id, item]));
		for (const item of page.items) memories.set(item.id, item);
		this.trashCursors = seen;
		this.set({ memories: [...memories.values()], nextCursor: page.next_cursor, ready: true });
	}

	loadMore(): Promise<boolean> {
		const cursor = this.state.nextCursor;
		if (this.kind !== "trash" || !cursor) return Promise.resolve(false);
		return this.run(() => this.readTrash(cursor));
	}

	private async refreshCommitted(): Promise<void> {
		try {
			await this.read();
		} catch (error) {
			this.set({ error: `已保存，但刷新失败：${libraryError(error)}` });
		}
	}

	changeTag(operation: "rename" | "merge", source: string, target: string): Promise<boolean> {
		return this.run(async () => {
			const tag = this.state.tags.find((item) => item.name === source);
			const name = target.trim();
			if (
				!tag ||
				!name ||
				name === source ||
				(operation === "merge" && !this.state.tags.some((item) => item.name === name))
			)
				throw new Error("请选择来源标签和另一个有效的目标标签。");
			const result = await this.api.request<
				LibraryTag | { from: LibraryTag; into: LibraryTag; memories: number }
			>(`/tags/${encodeURIComponent(source)}/${operation}`, {
				method: "POST",
				json: operation === "rename" ? { new_name: name } : { into: name },
			});
			this.set({
				notice:
					"memories" in result ? `已合并标签，影响 ${result.memories} 条记忆` : "已重命名标签",
			});
			await this.refreshCommitted();
		});
	}

	createSpace(input: { slug: string; name: string; description: string }): Promise<boolean> {
		return this.run(async () => {
			if (!input.slug.trim() || !input.name.trim()) throw new Error("请填写空间标识和名称。");
			await this.api.request("/spaces", {
				method: "POST",
				json: {
					slug: input.slug.trim(),
					name: input.name.trim(),
					description: input.description.trim(),
				},
			});
			this.set({ notice: "空间已创建" });
			await this.refreshCommitted();
		});
	}

	restore(ids: string[]): Promise<boolean> {
		return this.run(async () => {
			const unique = [...new Set(ids)];
			if (
				!unique.length ||
				unique.length > 100 ||
				unique.some((id) => !this.state.memories.some((item) => item.id === id))
			)
				throw new Error("请选择 1 至 100 条可用的记忆。");
			const restored = new Set<string>();
			const failures: LibraryState["failures"] = [];
			for (const id of unique) {
				try {
					await this.api.request(`/trash/${encodeURIComponent(id)}/restore`, { method: "POST" });
					restored.add(id);
				} catch (error) {
					failures.push({ id, message: libraryError(error) });
				}
			}
			this.set({
				memories: this.state.memories.filter((item) => !restored.has(item.id)),
				failures,
				notice: `已恢复 ${restored.size} / ${unique.length} 条记忆`,
			});
		});
	}

	beginPurge(id: string): void {
		const item = this.state.memories.find((memory) => memory.id === id);
		if (item && !this.state.busy) this.set({ purge: { id, title: item.title, stage: "title" } });
	}
	confirmPurgeTitle(title: string): boolean {
		const target = this.state.purge;
		if (!target || target.title !== title || this.state.busy) return false;
		this.set({ purge: { ...target, stage: "confirm" } });
		return true;
	}
	cancelPurge(): void {
		if (!this.state.busy) this.set({ purge: null });
	}
	purge(): Promise<boolean> {
		return this.run(async () => {
			const target = this.state.purge;
			if (target?.stage !== "confirm") throw new Error("请先输入标题并确认永久删除。");
			await this.api.request(`/trash/${encodeURIComponent(target.id)}`, { method: "DELETE" });
			this.set({
				memories: this.state.memories.filter((item) => item.id !== target.id),
				purge: null,
				notice: "记忆已永久删除",
			});
		});
	}
}
