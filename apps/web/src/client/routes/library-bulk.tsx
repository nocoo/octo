import { Button, ConfirmDialog, Field, Input, toast } from "@nocoo/basalt";
import { useState } from "react";
import { useModel } from "../components/layout/use-model";
import type { LibraryMemory } from "../viewmodels/library";
import { type BulkAction, BulkModel } from "../viewmodels/library-bulk";
import "./library.css";

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
		const message = `${model.state.succeeded.length} of ${selected.length} memories updated`;
		if (model.state.failures.length) toast.error(message);
		else toast.success(message);
		await onComplete(model.state.succeeded);
	}
	if (!selected.length) return null;
	return (
		<section className="library-stack" aria-label="Bulk memory actions">
			<p className="library-muted" role="status">
				{selected.length} selected. Maximum 100 memories per operation.
			</p>
			<div className="library-actions">
				<Field label="Add tags" htmlFor="bulk-tags">
					<Input
						id="bulk-tags"
						value={tags}
						onChange={(event) => setTags(event.target.value)}
						placeholder="tag-one, tag-two"
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
					Add tags
				</Button>
				<Field label="Move to space" htmlFor="bulk-space">
					<Input
						id="bulk-space"
						value={space}
						onChange={(event) => setSpace(event.target.value)}
						placeholder="Space slug"
						disabled={state.busy}
					/>
				</Field>
				<Button
					variant="outline"
					disabled={state.busy || selected.length > 100 || !space.trim()}
					onClick={() => void apply({ kind: "move", space })}
				>
					Move
				</Button>
				<Button
					variant="destructive"
					disabled={state.busy || selected.length > 100}
					onClick={() => setDeleting(true)}
				>
					Move to trash
				</Button>
			</div>
			{state.error && <p role="alert">{state.error}</p>}
			{state.failures.map((failure) => (
				<p key={failure.id} role="alert">
					{failure.id}: {failure.message}
				</p>
			))}
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={`Move ${selected.length} memories to trash?`}
				description={
					<>
						They remain recoverable in Trash.{" "}
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				variant="destructive"
				confirmLabel="Move to trash"
				loading={state.busy}
				onConfirm={() => apply({ kind: "delete" })}
			/>
		</section>
	);
}
