import { Button, ConfirmDialog, Field, Input, toast } from "@nocoo/basalt";
import { Grid } from "@nocoo/basalt/components/grid";
import { FolderInput, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { useModel } from "../components/layout/use-model";
import type { LibraryMemory } from "../viewmodels/library";
import { type BulkAction, BulkModel } from "../viewmodels/library-bulk";

export function LibraryBulkActions({
	memories,
	selected,
	onComplete,
}: {
	memories: LibraryMemory[];
	selected: string[];
	onComplete: (succeeded: string[]) => void | Promise<void>;
}) {
	const [model] = useState(() => new BulkModel());
	const state = useModel(model);
	const [tags, setTags] = useState("");
	const [space, setSpace] = useState("");
	const [deleting, setDeleting] = useState(false);
	async function apply(action: BulkAction) {
		if (!(await model.apply(memories, selected, action))) return;
		setDeleting(false);
		const message = `已更新 ${model.state.succeeded.length} / ${selected.length} 条记忆`;
		if (model.state.failures.length) toast.error(message);
		else toast.success(message);
		await onComplete(model.state.succeeded);
	}
	if (!selected.length) return null;
	return (
		<Grid columns={1} role="region" aria-label="批量操作记忆">
			<p className="text-basalt-sm text-basalt-muted-foreground" role="status">
				已选择 {selected.length} 条记忆，每次最多操作 100 条。
			</p>
			<Grid
				gap="sm"
				style={{
					gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, var(--basalt-space-56)), 1fr))",
					alignItems: "end",
				}}
			>
				<Field label="添加标签" htmlFor="bulk-tags">
					<Input
						id="bulk-tags"
						value={tags}
						onChange={(event) => setTags(event.target.value)}
						placeholder="标签一, 标签二"
						disabled={state.busy}
					/>
				</Field>
				<Button
					variant="outline"
					disabled={state.busy || selected.length > 100 || !tags.trim()}
					onClick={() =>
						void apply({
							kind: "tag",
							tags: tags
								.split(",")
								.map((tag) => tag.trim())
								.filter(Boolean),
						})
					}
				>
					<Tags size={16} aria-hidden="true" />
					添加标签
				</Button>
				<Field label="移至空间" htmlFor="bulk-space">
					<Input
						id="bulk-space"
						value={space}
						onChange={(event) => setSpace(event.target.value)}
						placeholder="空间标识"
						disabled={state.busy}
					/>
				</Field>
				<Button
					variant="outline"
					disabled={state.busy || selected.length > 100 || !space.trim()}
					onClick={() => void apply({ kind: "move", space })}
				>
					<FolderInput size={16} aria-hidden="true" />
					移动
				</Button>
				<Button
					variant="destructive"
					disabled={state.busy || selected.length > 100}
					onClick={() => setDeleting(true)}
				>
					<Trash2 size={16} aria-hidden="true" />
					移入回收站
				</Button>
			</Grid>
			{state.error && <p role="alert">{state.error}</p>}
			{state.failures.map((failure) => (
				<p key={failure.id} role="alert">
					{failure.id}: {failure.message}
				</p>
			))}
			<ConfirmDialog
				cancelLabel="取消"
				open={deleting}
				onOpenChange={setDeleting}
				title={`将 ${selected.length} 条记忆移入回收站？`}
				description={
					<>移入回收站后仍可恢复。 {state.error && <span role="alert">{state.error}</span>}</>
				}
				variant="destructive"
				confirmLabel="移入回收站"
				loading={state.busy}
				onConfirm={() => apply({ kind: "delete" })}
			/>
		</Grid>
	);
}
