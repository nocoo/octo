import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { type LibraryMemory, libraryError } from "./library";

export type BulkAction =
	| { kind: "tag"; tags: string[] }
	| { kind: "move"; space: string }
	| { kind: "delete" };
interface BulkState {
	busy: boolean;
	error: string | null;
	succeeded: string[];
	failures: { id: string; message: string }[];
}
type BatchResult = { ok: true; item: unknown } | { ok: false; error: { message: string } };

export class BulkModel extends Store<BulkState> {
	constructor(private readonly api: AdminClient = adminApi) {
		super({ busy: false, error: null, succeeded: [], failures: [] });
	}
	async apply(memories: LibraryMemory[], ids: string[], action: BulkAction): Promise<boolean> {
		if (this.state.busy) return false;
		this.set({ busy: true, error: null, succeeded: [], failures: [] });
		try {
			const unique = [...new Set(ids)];
			const available = new Map(memories.map((item) => [item.id, item]));
			if (!unique.length || unique.length > 100 || unique.some((id) => !available.has(id)))
				throw new Error("Select 1 to 100 available memories");
			if (action.kind === "move" && !action.space.trim())
				throw new Error("Choose a destination space");
			if (action.kind === "tag" && (!action.tags.length || action.tags.some((tag) => !tag.trim())))
				throw new Error("Provide non-empty tags");
			const items = unique.map((id) => {
				const item = available.get(id) as LibraryMemory;
				return {
					id,
					expected_version: item.version,
					...(action.kind === "move"
						? { space: action.space.trim() }
						: action.kind === "tag"
							? { tags: [...new Set([...item.tags, ...action.tags.map((tag) => tag.trim())])] }
							: {}),
				};
			});
			const response = await this.api.request<{ results: BatchResult[] }>(
				`/memories:batch${action.kind === "delete" ? "Delete" : "Update"}`,
				{ method: "POST", json: action.kind === "delete" ? { ids: unique } : { items } },
			);
			const succeeded: string[] = [];
			const failures: BulkState["failures"] = [];
			unique.forEach((id, index) => {
				const result = response.results[index];
				if (result?.ok) succeeded.push(id);
				else failures.push({ id, message: result ? result.error.message : "Missing batch result" });
			});
			this.set({ succeeded, failures });
			return true;
		} catch (error) {
			this.set({ error: libraryError(error) });
			return false;
		} finally {
			this.set({ busy: false });
		}
	}
}
