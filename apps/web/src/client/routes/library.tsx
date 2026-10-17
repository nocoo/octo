import {
	Badge,
	Button,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
	LayerCard,
	Link,
	SegmentControl,
	toast,
} from "@nocoo/basalt";
import { Timeline } from "@nocoo/basalt/charts/timeline";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
import {
	type LibraryKind,
	type LibraryMemory,
	LibraryModel,
	type LibrarySpace,
	type LibraryState,
	type LibraryTag,
	selectedIds,
	setSelection,
} from "../viewmodels/library";
import {
	buildGraph,
	buildTimeline,
	filterMemories,
	type GraphNode,
	graphOptions,
	type LibraryGraph,
	timelineOptions,
	updateLibraryUrl,
} from "../viewmodels/library-visualizations";
import "./library.css";

const GraphCanvas = lazy(() => import("./library-graph"));

function useLibrary(kind: LibraryKind) {
	const [model] = useState(() => new LibraryModel(kind));
	const state = useModel(model);
	useEffect(() => {
		void model.load();
	}, [model]);
	useEffect(() => {
		if (state.notice) toast.success(state.notice);
	}, [state.notice]);
	return { model, state };
}

function LibraryStatus({ state, onRetry }: { state: LibraryState; onRetry: () => void }) {
	return (
		<>
			{state.busy && !state.ready && <p role="status">Loading library...</p>}
			{state.error && (
				<p role="alert">
					{state.error}{" "}
					<Button size="sm" variant="outline" onClick={onRetry} disabled={state.busy}>
						Retry
					</Button>
				</p>
			)}
			{state.notice && (
				<p role="status" className="library-muted">
					{state.notice}
				</p>
			)}
			{state.truncated && (
				<p role="status">
					Showing the first {state.memories.length} memories. Graphs and timelines represent this
					sample, not the entire library.
				</p>
			)}
		</>
	);
}

function SpaceFilter({
	memories,
	value,
	onChange,
}: {
	memories: LibraryMemory[];
	value: string;
	onChange: (value: string) => void;
}) {
	const spaces = [...new Set(memories.map((memory) => memory.space))].sort();
	return (
		<Select
			value={value || "__all__"}
			onValueChange={(next) => onChange(next === "__all__" ? "" : next)}
		>
			<SelectTrigger aria-label="Filter by space">
				<SelectValue placeholder="All spaces" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="__all__">All spaces</SelectItem>
				{spaces.map((space) => (
					<SelectItem key={space} value={space}>
						{space}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function GraphTables({
	graph,
	selected,
	onSelected,
}: {
	graph: LibraryGraph;
	selected: string[];
	onSelected: (ids: string[]) => void;
}) {
	const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
	const columns: DataTableColumn<GraphNode>[] = [
		{
			id: "label",
			header: "Node",
			accessor: (node) => (node.href ? <Link href={node.href}>{node.label}</Link> : node.label),
			sortValue: (node) => node.label,
			wrap: true,
		},
		{
			id: "kind",
			header: "Kind",
			accessor: (node) => <Badge variant="secondary">{node.kind}</Badge>,
			sortValue: (node) => node.kind,
		},
		{
			id: "count",
			header: "Count",
			accessor: (node) => node.count,
			sortValue: (node) => node.count,
			textAlign: "end",
			cellClassName: "library-numeric",
		},
	];
	return (
		<div className="library-stack">
			<DataTable
				aria-label="Graph nodes"
				data={graph.nodes}
				columns={columns}
				getRowId={(node) => node.id}
				selected={selected}
				onSelectedChange={onSelected}
				pageSize={20}
				empty="No nodes match these filters."
			/>
			<DataTable
				aria-label="Graph relationships"
				data={graph.links}
				columns={[
					{
						id: "source",
						header: "From",
						accessor: (link) => labels.get(link.source),
						sortValue: (link) => labels.get(link.source) ?? link.source,
						wrap: true,
					},
					{
						id: "target",
						header: "To",
						accessor: (link) => labels.get(link.target),
						sortValue: (link) => labels.get(link.target) ?? link.target,
						wrap: true,
					},
					{
						id: "value",
						header: "Weight",
						accessor: (link) => link.value,
						sortValue: (link) => link.value,
						textAlign: "end",
					},
				]}
				getRowId={(link) => JSON.stringify([link.source, link.target])}
				pageSize={20}
				empty="No relationships in this sample."
			/>
		</div>
	);
}

export function TagsPage() {
	const { model, state } = useLibrary("tags");
	const [params, setParams] = useSearchParams();
	const [operation, setOperation] = useState<"rename" | "merge">("rename");
	const [target, setTarget] = useState("");
	const [confirming, setConfirming] = useState(false);
	const source = state.tags.find((tag) => tag.name === params.get("tag"));
	const graph = useMemo(
		() => buildGraph(filterMemories(state.memories, params), "cooccurrence", 150),
		[state.memories, params],
	);
	const query = params.get("q") ?? "";
	const columns: DataTableColumn<LibraryTag>[] = [
		{
			id: "name",
			header: "Tag",
			accessor: (tag) => (
				<Link href={`/memories?${new URLSearchParams({ tags_all: tag.name })}`}>
					{tag.display_name}
				</Link>
			),
			sortValue: (tag) => tag.name,
		},
		{
			id: "count",
			header: "Memories",
			accessor: (tag) => tag.use_count,
			sortValue: (tag) => tag.use_count,
			textAlign: "end",
			cellClassName: "library-numeric",
		},
		{
			id: "actions",
			header: "Actions",
			sortable: false,
			accessor: (tag) => (
				<div className="library-actions">
					{(["rename", "merge"] as const).map((action) => (
						<Button
							key={action}
							size="sm"
							variant="outline"
							disabled={state.busy}
							onClick={() => {
								setParams(updateLibraryUrl(params, "tag", tag.name));
								setOperation(action);
								setTarget("");
							}}
							aria-label={`${action} ${tag.display_name}`}
						>
							{action === "rename" ? "Rename" : "Merge"}
						</Button>
					))}
				</div>
			),
		},
	];
	function close() {
		setConfirming(false);
		setParams(updateLibraryUrl(params, "tag", ""));
	}
	return (
		<div className="library-page">
			<PageHeader
				title="Tags"
				description="Shared vocabulary, usage and relationships across spaces."
				actions={
					<>
						<Input
							className="library-search"
							aria-label="Filter tags"
							placeholder="Find a tag"
							value={query}
							onChange={(event) => setParams(updateLibraryUrl(params, "q", event.target.value))}
						/>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							Refresh
						</Button>
					</>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			<LayerCard>
				<DataTable
					aria-label="Tags"
					data={state.tags}
					columns={columns}
					filter={query}
					getRowId={(tag) => tag.id}
					pageSize={25}
					edge="attached"
					loading={state.busy && !state.ready}
					empty="No tags match your search."
				/>
			</LayerCard>
			<SectionRule title="Tag cooccurrence" hint="Each edge counts memories carrying both tags.">
				<LayerCard>
					<LayerCard.Header>
						Vocabulary connections <Link href="/graph?mode=cooccurrence">Explore graph</Link>
					</LayerCard.Header>
					<LayerCard.Body>
						<Suspense fallback={<p role="status">Loading graph...</p>}>
							<GraphCanvas graph={graph} />
						</Suspense>
						<GraphTables
							graph={graph}
							selected={params.get("node") ? [params.get("node") as string] : []}
							onSelected={(ids) => setParams(updateLibraryUrl(params, "node", ids[0] ?? ""))}
						/>
					</LayerCard.Body>
				</LayerCard>
			</SectionRule>
			<Dialog
				open={Boolean(source) && !confirming}
				onOpenChange={(open) => {
					if (!open && !state.busy) close();
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						if (confirming) event.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{operation === "rename" ? "Rename" : "Merge"} {source?.display_name}
						</DialogTitle>
						<DialogDescription>This changes a global tag across every space.</DialogDescription>
					</DialogHeader>
					<form
						className="library-stack"
						onSubmit={(event) => {
							event.preventDefault();
							setConfirming(true);
						}}
					>
						{operation === "rename" ? (
							<Field label="New tag name" htmlFor="tag-target" required>
								<Input
									id="tag-target"
									value={target}
									onChange={(event) => setTarget(event.target.value)}
									required
									maxLength={64}
									disabled={state.busy}
								/>
							</Field>
						) : (
							<Field label="Merge into" htmlFor="tag-target" required>
								<Select value={target} onValueChange={setTarget} disabled={state.busy}>
									<SelectTrigger id="tag-target">
										<SelectValue placeholder="Choose an existing tag" />
									</SelectTrigger>
									<SelectContent>
										{state.tags
											.filter((tag) => tag.name !== source?.name)
											.map((tag) => (
												<SelectItem key={tag.id} value={tag.name}>
													{tag.display_name} ({tag.use_count})
												</SelectItem>
											))}
									</SelectContent>
								</Select>
							</Field>
						)}
						<p role="status">
							Affects {source?.use_count ?? 0} memories.{" "}
							{operation === "merge" && "Duplicate tag assignments collapse into one."}
						</p>
						<DialogFooter>
							<Button variant="outline" disabled={state.busy} onClick={close}>
								Cancel
							</Button>
							<Button type="submit" disabled={!target.trim() || target.trim() === source?.name}>
								Review changes
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={confirming && Boolean(source)}
				onOpenChange={(open) => {
					if (!open) close();
				}}
				title={`${operation === "rename" ? "Rename" : "Merge"} tag across all spaces?`}
				description={
					<>
						This affects {source?.use_count ?? 0} memories: {source?.display_name} → {target}.
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				loading={state.busy}
				confirmLabel={operation === "rename" ? "Rename tag" : "Merge tags"}
				onConfirm={async () => {
					if (source && (await model.changeTag(operation, source.name, target))) close();
				}}
			/>
		</div>
	);
}

export function SpacesPage() {
	const { model, state } = useLibrary("spaces");
	const [params, setParams] = useSearchParams();
	const [creating, setCreating] = useState(false);
	const columns: DataTableColumn<LibrarySpace>[] = [
		{
			id: "name",
			header: "Space",
			accessor: (space) => (
				<Link href={`/memories?${new URLSearchParams({ spaces: space.slug })}`}>{space.name}</Link>
			),
			sortValue: (space) => space.name,
		},
		{ id: "slug", header: "Slug", accessor: (space) => space.slug },
		{
			id: "description",
			header: "Description",
			accessor: (space) => space.description,
			wrap: true,
		},
		{
			id: "owner",
			header: "Owner key",
			accessor: (space) =>
				space.owner_key_id ? (
					<Link href="/keys">
						{state.keys.find((key) => key.id === space.owner_key_id)?.name ?? space.owner_key_id}
					</Link>
				) : (
					"Not assigned"
				),
			sortValue: (space) => space.owner_key_id ?? "",
		},
		{
			id: "count",
			header: "Memories",
			accessor: (space) => space.memory_count,
			sortValue: (space) => space.memory_count,
			textAlign: "end",
			cellClassName: "library-numeric",
		},
	];
	return (
		<div className="library-page">
			<PageHeader
				title="Spaces"
				description="Boundaries for knowledge and the agents responsible for it."
				actions={
					<>
						<Input
							className="library-search"
							aria-label="Filter spaces"
							value={params.get("q") ?? ""}
							onChange={(event) => setParams(updateLibraryUrl(params, "q", event.target.value))}
							placeholder="Find a space"
						/>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							Refresh
						</Button>
						<Button disabled={state.busy} onClick={() => setCreating(true)}>
							Create space
						</Button>
					</>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			<LayerCard>
				<DataTable
					aria-label="Spaces"
					data={state.spaces}
					columns={columns}
					filter={params.get("q") ?? ""}
					getRowId={(space) => space.id}
					pageSize={25}
					edge="attached"
					loading={state.busy && !state.ready}
					empty="No spaces found. Create a space to organize memories."
				/>
			</LayerCard>
			<Dialog
				open={creating}
				onOpenChange={(open) => {
					if (!state.busy) setCreating(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create space</DialogTitle>
						<DialogDescription>
							Spaces keep knowledge organized. Key ownership is managed through API key permissions.
						</DialogDescription>
					</DialogHeader>
					<form
						className="library-stack"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							if (
								await model.createSpace({
									slug: String(form.get("slug")),
									name: String(form.get("name")),
									description: String(form.get("description")),
								})
							)
								setCreating(false);
						}}
					>
						<Field label="Slug" htmlFor="space-slug" required>
							<Input
								id="space-slug"
								name="slug"
								required
								maxLength={64}
								disabled={state.busy}
								autoComplete="off"
							/>
						</Field>
						<Field label="Name" htmlFor="space-name" required>
							<Input id="space-name" name="name" required disabled={state.busy} />
						</Field>
						<Field label="Description" htmlFor="space-description">
							<Input id="space-description" name="description" disabled={state.busy} />
						</Field>
						{state.error && <p role="alert">{state.error}</p>}
						<DialogFooter>
							<Button variant="outline" disabled={state.busy} onClick={() => setCreating(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={state.busy}>
								Create space
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}

export function TrashPage() {
	const { model, state } = useLibrary("trash");
	const [params, setParams] = useSearchParams();
	const [title, setTitle] = useState("");
	const region = useRef<HTMLDivElement>(null);
	const selected = selectedIds(params);
	const visible = filterMemories(state.memories, params);
	const columns: DataTableColumn<LibraryMemory>[] = [
		{ id: "title", header: "Memory", accessor: (item) => item.title, wrap: true },
		{ id: "space", header: "Space", accessor: (item) => item.space },
		{
			id: "deleted",
			header: "Trashed at",
			accessor: (item) =>
				item.deleted_at ? new Date(item.deleted_at).toLocaleString() : "Unknown",
			sortValue: (item) => item.deleted_at ?? "",
		},
		{
			id: "purge",
			header: "Permanent deletion",
			sortable: false,
			accessor: (item) => (
				<Button
					size="sm"
					variant="destructive"
					disabled={state.busy}
					aria-label={`Permanently delete ${item.title}`}
					onClick={() => {
						setTitle("");
						model.beginPurge(item.id);
					}}
				>
					Permanently delete
				</Button>
			),
		},
	];
	return (
		<div className="library-page" ref={region} tabIndex={-1}>
			<PageHeader
				title="Trash"
				description="Nothing is automatically purged. Restore memories, or permanently delete with two confirmations."
				actions={
					<>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							Refresh
						</Button>
						<Button
							loading={state.busy}
							disabled={!selected.length || selected.length > 100}
							onClick={async () => {
								if (await model.restore(selected))
									setParams(
										setSelection(
											params,
											selected.filter((id) => model.state.memories.some((item) => item.id === id)),
										),
									);
							}}
						>
							Restore selected ({selected.length})
						</Button>
					</>
				}
				filters={
					<div className="library-actions">
						<Input
							className="library-search"
							aria-label="Filter trash"
							placeholder="Find a trashed memory"
							value={params.get("q") ?? ""}
							onChange={(event) => setParams(updateLibraryUrl(params, "q", event.target.value))}
						/>
						<SpaceFilter
							memories={state.memories}
							value={params.get("space") ?? ""}
							onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
						/>
					</div>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			{state.failures.map((failure) => (
				<p key={failure.id} role="alert">
					{failure.id}: {failure.message}
				</p>
			))}
			<LayerCard>
				<DataTable
					aria-label="Trashed memories"
					data={visible}
					columns={columns}
					selected={selected}
					onSelectedChange={(ids) => setParams(setSelection(params, ids))}
					multiple
					getRowId={(item) => item.id}
					pageSize={25}
					edge="attached"
					loading={state.busy && !state.ready}
					empty="Trash is empty for these filters."
				/>
			</LayerCard>
			<Dialog
				open={state.purge?.stage === "title"}
				onOpenChange={(open) => {
					if (!open) model.cancelPurge();
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!model.state.purge) region.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>Type the memory title</DialogTitle>
						<DialogDescription>
							Permanent deletion removes this memory and its versions and attachments. Type the
							exact title: <strong>{state.purge?.title}</strong>
						</DialogDescription>
					</DialogHeader>
					<form
						className="library-stack"
						onSubmit={(event) => {
							event.preventDefault();
							model.confirmPurgeTitle(title);
						}}
					>
						<Field label="Confirm title" htmlFor="purge-title" required>
							<Input
								id="purge-title"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								autoComplete="off"
								required
							/>
						</Field>
						<DialogFooter>
							<Button variant="outline" onClick={() => model.cancelPurge()}>
								Cancel
							</Button>
							<Button type="submit" variant="destructive" disabled={title !== state.purge?.title}>
								Continue
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={state.purge?.stage === "confirm"}
				onOpenChange={(open) => {
					if (!open) model.cancelPurge();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					region.current?.focus();
				}}
				title="Delete permanently?"
				description={
					<>
						Final confirmation: {state.purge?.title} cannot be restored after this operation.
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				confirmLabel="Delete permanently"
				variant="destructive"
				loading={state.busy}
				onConfirm={async () => {
					const id = state.purge?.id;
					if (await model.purge())
						setParams(
							setSelection(
								params,
								selected.filter((item) => item !== id),
							),
						);
				}}
			/>
		</div>
	);
}

export function GraphPage() {
	const { model, state } = useLibrary("graph");
	const [params, setParams] = useSearchParams();
	const options = graphOptions(params);
	const graph = useMemo(
		() => buildGraph(filterMemories(state.memories, params), options.mode, options.cap),
		[state.memories, params, options.mode, options.cap],
	);
	return (
		<div className="library-page">
			<PageHeader
				title="Relationship graph"
				description="Explore tag-to-memory links or shared vocabulary. Large graphs cluster their least-used nodes."
				actions={
					<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
						Refresh
					</Button>
				}
				filters={
					<div className="library-actions">
						<SegmentControl
							legend="Relationships"
							value={options.mode}
							onValueChange={(value) => setParams(updateLibraryUrl(params, "mode", value))}
							options={[
								{ value: "bipartite", label: "Tags and memories" },
								{ value: "cooccurrence", label: "Tag cooccurrence" },
							]}
						/>
						<SpaceFilter
							memories={state.memories}
							value={params.get("space") ?? ""}
							onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
						/>
						<Field label="Node limit" htmlFor="graph-cap">
							<Input
								id="graph-cap"
								type="number"
								min={10}
								max={500}
								value={options.cap}
								onChange={(event) => setParams(updateLibraryUrl(params, "cap", event.target.value))}
							/>
						</Field>
					</div>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			<LayerCard>
				<LayerCard.Header>
					<span>
						{graph.nodes.length} nodes · {graph.links.length} relationships
					</span>
					{graph.clustered > 0 && (
						<Badge variant="secondary">{graph.clustered} nodes clustered</Badge>
					)}
				</LayerCard.Header>
				<LayerCard.Body>
					<Suspense fallback={<p role="status">Loading graph...</p>}>
						<GraphCanvas graph={graph} />
					</Suspense>
				</LayerCard.Body>
			</LayerCard>
			<SectionRule
				title="Accessible graph data"
				hint="Select a node here or on the canvas; selection is stored in the URL."
			>
				<LayerCard>
					<LayerCard.Body>
						<GraphTables
							graph={graph}
							selected={params.get("node") ? [params.get("node") as string] : []}
							onSelected={(ids) => setParams(updateLibraryUrl(params, "node", ids[0] ?? ""))}
						/>
					</LayerCard.Body>
				</LayerCard>
			</SectionRule>
		</div>
	);
}

export function TimelinePage() {
	const { model, state } = useLibrary("timeline");
	const [params, setParams] = useSearchParams();
	const options = timelineOptions(params);
	const timeline = buildTimeline(filterMemories(state.memories, params), options);
	const columns: DataTableColumn<LibraryMemory & { timestamp: number }>[] = [
		{
			id: "time",
			header: "Time (UTC)",
			accessor: (item) => new Date(item.timestamp).toISOString(),
			sortValue: (item) => item.timestamp,
		},
		{
			id: "memory",
			header: "Memory",
			accessor: (item) => (
				<Link href={`/memories/${encodeURIComponent(item.id)}`}>{item.title}</Link>
			),
			sortValue: (item) => item.title,
			wrap: true,
		},
		{ id: "space", header: "Space", accessor: (item) => item.space },
	];
	const rangeField = (name: "from" | "to", label: string): ReactNode => (
		<Field
			label={label}
			htmlFor={`timeline-${name}`}
			hint="Inclusive UTC timestamp, for example 2026-10-17T00:00:00Z."
		>
			<Input
				id={`timeline-${name}`}
				type="text"
				placeholder="2026-10-17T00:00:00Z"
				value={params.get(name) ?? ""}
				onChange={(event) => setParams(updateLibraryUrl(params, name, event.target.value))}
			/>
		</Field>
	);
	return (
		<div className="library-page">
			<PageHeader
				title="Timeline"
				description="Event time describes when something happened; creation time describes when Octo received it. All buckets use UTC."
				actions={
					<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
						Refresh
					</Button>
				}
				filters={
					<div className="library-actions">
						<SegmentControl
							legend="Time field"
							value={options.field}
							onValueChange={(value) => setParams(updateLibraryUrl(params, "field", value))}
							options={[
								{ value: "event_time", label: "Event time" },
								{ value: "created_at", label: "Created at" },
							]}
						/>
						<SegmentControl
							legend="Zoom"
							value={options.zoom}
							onValueChange={(value) => setParams(updateLibraryUrl(params, "zoom", value))}
							options={[
								{ value: "hour", label: "Hour" },
								{ value: "day", label: "Day" },
								{ value: "month", label: "Month" },
							]}
						/>
						<SpaceFilter
							memories={state.memories}
							value={params.get("space") ?? ""}
							onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
						/>
						{rangeField("from", "From (UTC)")}
						{rangeField("to", "To (UTC)")}
					</div>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			{timeline.undated > 0 && (
				<p className="library-muted">
					{timeline.undated} memories have no valid {options.field}; no creation-time fallback is
					applied.
				</p>
			)}
			{timeline.groups.length === 0 && (
				<LayerCard>
					<LayerCard.Empty
						title="No dated memories"
						description="Try another time field, range or space."
					/>
				</LayerCard>
			)}
			{timeline.groups.map((group) => (
				<LayerCard key={group.label}>
					<LayerCard.Header>
						{group.label} <Badge variant="secondary">{group.items.length} memories</Badge>
					</LayerCard.Header>
					<LayerCard.Body>
						<Timeline
							ariaLabel={`Memories in ${group.label}`}
							events={group.items.map((item) => ({
								id: item.id,
								time: new Date(item.timestamp).toISOString(),
								title: item.title,
								subtitle: item.space,
							}))}
						/>
						<DataTable
							aria-label={`Timeline data ${group.label}`}
							data={group.items}
							columns={columns}
							getRowId={(item) => item.id}
							selected={selectedIds(params)}
							onSelectedChange={(ids) => setParams(setSelection(params, ids))}
							pageSize={20}
						/>
					</LayerCard.Body>
				</LayerCard>
			))}
		</div>
	);
}
