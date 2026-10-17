import { type AdminClient, adminApi } from "../lib/api";
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

export function libraryError(error: unknown): string {
	return error instanceof Error ? error.message : "Request failed";
}

export class LibraryModel extends Store<LibraryState> {
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
			const page: ListPage<LibraryMemory> = await this.api.request(
				`/${this.kind === "trash" ? "trash" : "memories"}?${query}`,
			);
			memories.push(...page.items);
			cursor = page.next_cursor;
			if (cursor && seen.has(cursor)) throw new Error("Repeated pagination cursor");
			if (cursor) seen.add(cursor);
		} while (cursor && memories.length < 2000);
		this.set({ memories, tags, ready: true, truncated: cursor !== null });
	}

	load(): Promise<boolean> {
		return this.run(() => this.read());
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
				throw new Error("Choose a source and a different valid target");
			await this.api.request(`/tags/${encodeURIComponent(source)}/${operation}`, {
				method: "POST",
				json: operation === "rename" ? { new_name: name } : { into: name },
			});
			this.set({
				notice: `${operation === "rename" ? "Renamed" : "Merged"} tag affecting ${tag.use_count} memories`,
			});
			await this.read();
		});
	}

	createSpace(input: { slug: string; name: string; description: string }): Promise<boolean> {
		return this.run(async () => {
			if (!input.slug.trim() || !input.name.trim())
				throw new Error("Space slug and name are required");
			await this.api.request("/spaces", {
				method: "POST",
				json: {
					slug: input.slug.trim(),
					name: input.name.trim(),
					description: input.description.trim(),
				},
			});
			this.set({ notice: "Space created" });
			await this.read();
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
				throw new Error("Select 1 to 100 available memories");
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
				notice: `Restored ${restored.size} of ${unique.length} memories`,
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
			if (target?.stage !== "confirm")
				throw new Error("Type the title and confirm permanent deletion first");
			await this.api.request(`/trash/${encodeURIComponent(target.id)}`, { method: "DELETE" });
			this.set({
				memories: this.state.memories.filter((item) => item.id !== target.id),
				purge: null,
				notice: "Memory permanently deleted",
			});
		});
	}
}
