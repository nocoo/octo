import { diffArrays } from "diff";
import { memoryPatchSchema } from "../../lib/schema/memory";
import { type AdminClient, ApiError, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { type Attachment, errorMessage, type Memory } from "./memories";

export type MemoryDraft = Pick<
	Memory,
	"title" | "body" | "space" | "type" | "tags" | "importance" | "event_time"
>;
export type DraftField = keyof MemoryDraft;
const draftFields = ["title", "body", "space", "type", "tags", "importance", "event_time"] as const;
const same = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

export function toDraft(memory: Memory): MemoryDraft {
	return {
		title: memory.title,
		body: memory.body,
		space: memory.space,
		type: memory.type,
		tags: [...memory.tags],
		importance: memory.importance,
		event_time: memory.event_time,
	};
}

type Edit = { start: number; end: number; lines: string[] };
function edits(base: string[], changed: string[]): Edit[] {
	const result: Edit[] = [];
	let position = 0;
	let edit: Edit | undefined;
	for (const change of diffArrays(base, changed)) {
		if (!change.added && !change.removed) {
			if (edit) result.push(edit);
			edit = undefined;
			position += change.count;
		} else {
			edit ??= { start: position, end: position, lines: [] };
			if (change.removed) {
				position += change.count;
				edit.end = position;
			} else edit.lines.push(...change.value);
		}
	}
	if (edit) result.push(edit);
	return result;
}

function overlaps(left: Edit, right: Edit): boolean {
	if (left.start === left.end && right.start === right.end) return left.start === right.start;
	if (left.start === left.end) return left.start > right.start && left.start < right.end;
	if (right.start === right.end) return right.start > left.start && right.start < left.end;
	return left.start < right.end && right.start < left.end;
}

export function mergeText(
	base: string,
	mine: string,
	theirs: string,
): { text: string; conflict: boolean } {
	if (mine === base) return { text: theirs, conflict: false };
	if (theirs === base || mine === theirs) return { text: mine, conflict: false };
	const lines = base.split("\n");
	const mineEdits = edits(lines, mine.split("\n"));
	const theirEdits = edits(lines, theirs.split("\n"));
	for (const left of mineEdits) {
		for (const right of theirEdits) {
			if (overlaps(left, right) && !same(left, right)) return { text: mine, conflict: true };
		}
	}
	const merged = [
		...mineEdits,
		...theirEdits.filter((right) => !mineEdits.some((left) => same(left, right))),
	];
	merged.sort((left, right) => right.start - left.start || right.end - left.end);
	for (const edit of merged) lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
	return { text: lines.join("\n"), conflict: false };
}

export function mergeDrafts(
	base: MemoryDraft,
	mine: MemoryDraft,
	theirs: MemoryDraft,
): { merged: MemoryDraft; conflicts: DraftField[] } {
	const merged = { ...mine };
	const conflicts: DraftField[] = [];
	for (const field of draftFields) {
		if (same(mine[field], base[field])) Object.assign(merged, { [field]: theirs[field] });
		else if (!same(theirs[field], base[field]) && !same(theirs[field], mine[field])) {
			if (field === "body") {
				const body = mergeText(base.body, mine.body, theirs.body);
				merged.body = body.text;
				if (body.conflict) conflicts.push(field);
			} else conflicts.push(field);
		}
	}
	return { merged, conflicts };
}

interface Conflict {
	base: MemoryDraft;
	mine: MemoryDraft;
	theirs: MemoryDraft;
	current: Memory;
	merged: MemoryDraft;
	fields: DraftField[];
	unresolved: DraftField[];
}

export class EditorModel extends Store<{
	base: Memory | null;
	draft: MemoryDraft | null;
	conflict: Conflict | null;
	dirty: boolean;
	loading: boolean;
	saving: boolean;
	uploading: boolean;
	error: string | null;
	notice: string | null;
}> {
	private generation = 0;
	constructor(
		readonly id: string,
		private readonly api: AdminClient = adminApi,
	) {
		super({
			base: null,
			draft: null,
			conflict: null,
			dirty: false,
			loading: false,
			saving: false,
			uploading: false,
			error: null,
			notice: null,
		});
	}
	get hasPendingChanges(): boolean {
		return this.state.dirty || this.state.saving || this.state.uploading;
	}
	blocksNavigation(currentPathname: string, nextPathname: string): boolean {
		return this.hasPendingChanges && currentPathname !== nextPathname;
	}
	async load(): Promise<void> {
		const generation = ++this.generation;
		this.set({ loading: true, error: null });
		try {
			const base = await this.api.request<Memory>(`/memories/${encodeURIComponent(this.id)}`);
			if (generation !== this.generation) return;
			this.set({ base, draft: toDraft(base), dirty: false, conflict: null });
		} catch (error) {
			if (generation === this.generation) this.set({ error: errorMessage(error) });
		} finally {
			if (generation === this.generation) this.set({ loading: false });
		}
	}
	update(patch: Partial<MemoryDraft>): void {
		if (!this.state.draft || this.state.conflict) return;
		this.set({ draft: { ...this.state.draft, ...patch }, dirty: true, notice: null });
	}
	async save(): Promise<void> {
		const { base, draft, conflict, saving } = this.state;
		if (!base || !draft || saving || conflict || this.state.uploading) return;
		this.set({ saving: true, error: null, notice: null });
		try {
			const json = memoryPatchSchema.parse(draft);
			const current = await this.api.request<Memory>(`/memories/${encodeURIComponent(this.id)}`, {
				method: "PATCH",
				json,
				headers: { "If-Match": String(base.version) },
			});
			const latest = this.state.draft as MemoryDraft;
			const next = toDraft(current);
			for (const field of draftFields)
				if (!same(latest[field], draft[field])) Object.assign(next, { [field]: latest[field] });
			this.set({
				base: current,
				draft: next,
				dirty: !same(next, toDraft(current)),
				notice: `已保存第 ${current.version} 版`,
			});
		} catch (error) {
			if (error instanceof ApiError && error.code === "version_conflict") {
				try {
					const current = await this.api.request<Memory>(
						`/memories/${encodeURIComponent(this.id)}`,
					);
					const mine = this.state.draft as MemoryDraft;
					const result = mergeDrafts(toDraft(base), mine, toDraft(current));
					this.set({
						conflict: {
							base: toDraft(base),
							mine,
							theirs: toDraft(current),
							current,
							merged: result.merged,
							fields: result.conflicts,
							unresolved: result.conflicts,
						},
					});
				} catch (refreshError) {
					this.set({ error: errorMessage(refreshError) });
				}
			} else this.set({ error: errorMessage(error) });
		} finally {
			this.set({ saving: false });
		}
	}
	resolveField<Field extends DraftField>(field: Field, value: MemoryDraft[Field]): void {
		const conflict = this.state.conflict;
		if (!conflict) return;
		this.set({
			conflict: {
				...conflict,
				merged: { ...conflict.merged, [field]: value },
				unresolved: conflict.unresolved.filter((item) => item !== field),
			},
		});
	}
	finishMerge(): void {
		const conflict = this.state.conflict;
		if (!conflict || conflict.unresolved.length) return;
		this.set({
			base: conflict.current,
			draft: conflict.merged,
			dirty: true,
			conflict: null,
			notice: "已与最新版本合并，请检查后保存。",
		});
	}
	cancelMerge(): void {
		this.set({ conflict: null });
	}
	async upload(file: Blob & { name: string }): Promise<void> {
		if (!this.state.draft || this.state.uploading || this.state.conflict) return;
		this.set({ uploading: true, error: null });
		try {
			if (file.size > 50 * 1024 * 1024) throw new Error("附件大小不能超过 50 MiB。");
			if (
				![
					"image/png",
					"image/jpeg",
					"image/webp",
					"image/gif",
					"image/svg+xml",
					"application/pdf",
				].includes(file.type)
			)
				throw new Error("请选择支持的图片或 PDF 文件。");
			const body = new FormData();
			body.append("file", file, file.name);
			const attachment = await this.api.request<Attachment>(
				`/memories/${encodeURIComponent(this.id)}/attachments`,
				{
					method: "POST",
					body,
				},
			);
			const label = file.name.replace(/[\\[\]]/g, "\\$&");
			const reference =
				file.type.startsWith("image/") && file.type !== "image/svg+xml"
					? `![](octo://att/${attachment.id})`
					: `[${label}](octo://att/${attachment.id})`;
			this.update({ body: `${this.state.draft.body}\n\n${reference}` });
		} catch (error) {
			this.set({ error: errorMessage(error) });
		} finally {
			this.set({ uploading: false });
		}
	}
}
