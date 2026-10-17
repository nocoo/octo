import {
	Badge,
	Button,
	Checkbox,
	ConfirmDialog,
	DescriptionList,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	Field,
	Input,
	LayerCard,
	SegmentControl,
	Sheet,
	SheetContent,
	SheetTitle,
	toast,
} from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { FileDropzone } from "@nocoo/basalt/components/file-dropzone";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { useEffect, useMemo, useState } from "react";
import {
	Link,
	useBlocker,
	useLocation,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router";
import { MEMORY_TYPES } from "../../lib/schema/memory";
import { Markdown, MarkdownContents } from "../components/layout/markdown";
import { useModel } from "../components/layout/use-model";
import { selectedIds, setSelection } from "../viewmodels/library";
import { HistoryModel, MemoriesModel, type Memory, MemoryModel } from "../viewmodels/memories";
import { EditorModel } from "../viewmodels/memories-editor";
import { diffLines, markdownContents } from "../viewmodels/memories-markdown";
import { LibraryBulkActions } from "./library-bulk";
import { Choice, MemoryFilters } from "./memories-filters";
import { MemoryLink, memoryTransition } from "./memories-navigation";

function Feedback({
	error,
	loading,
	retry,
}: {
	error: string | null;
	loading: boolean;
	retry: () => void;
}) {
	return (
		<>
			{error && (
				<Banner
					variant="error"
					title="Request failed"
					description={error}
					action={<Banner.Action onClick={retry}>Retry</Banner.Action>}
				/>
			)}
			{loading && (
				<p role="status" className="octo-muted">
					Loading...
				</p>
			)}
		</>
	);
}

function MemoryTags({ memory }: { memory: Pick<Memory, "tags" | "space" | "type"> }) {
	return (
		<div className="octo-actions">
			<Badge variant="outline">{memory.space}</Badge>
			<Badge variant="secondary">{memory.type}</Badge>
			{memory.tags.map((tag) => (
				<Badge key={tag} variant="outline">
					{tag}
				</Badge>
			))}
		</div>
	);
}

export function MemoriesPage() {
	const [params, setParams] = useSearchParams();
	const model = useMemo(() => new MemoriesModel(), []);
	const state = useModel(model);
	const selected = selectedIds(params);
	const requestParams = new URLSearchParams(params);
	for (const key of ["selected", "view", "focus"]) requestParams.delete(key);
	const query = requestParams.toString();
	useEffect(() => {
		void model.load(new URLSearchParams(query));
	}, [model, query]);
	const cards = params.get("view") === "cards";
	function select(id: string, checked: boolean) {
		setParams(
			setSelection(params, checked ? [...selected, id] : selected.filter((item) => item !== id)),
		);
	}
	function row(memory: Memory) {
		return (
			<>
				<Checkbox
					aria-label={`Select ${memory.title}`}
					checked={selected.includes(memory.id)}
					onCheckedChange={(checked) => select(memory.id, checked === true)}
				/>
				<MemoryLink memoryId={memory.id} memoryTitle={memory.title} data-memory-link={memory.id}>
					<strong>{memory.title}</strong>
				</MemoryLink>
			</>
		);
	}
	useEffect(() => {
		function key(event: KeyboardEvent) {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
			if (
				event.target instanceof HTMLElement &&
				event.target.closest("input,textarea,[role=combobox],[contenteditable=true]")
			)
				return;
			if (!["j", "k"].includes(event.key) || !state.items.length) return;
			event.preventDefault();
			const active = params.get("focus");
			const index = state.items.findIndex((item) => item.id === active);
			const next =
				state.items[
					Math.max(0, Math.min(state.items.length - 1, index + (event.key === "j" ? 1 : -1)))
				];
			if (next) {
				const url = new URLSearchParams(params);
				url.set("focus", next.id);
				setParams(url, { replace: true });
				document.querySelector<HTMLElement>(`[data-memory-link="${CSS.escape(next.id)}"]`)?.focus();
			}
		}
		document.addEventListener("keydown", key);
		return () => document.removeEventListener("keydown", key);
	}, [params, setParams, state.items]);
	return (
		<div className="octo-page">
			<PageHeader
				title="Memories"
				description="Your private knowledge, across every space."
				actions={
					<SegmentControl
						legend="View"
						value={cards ? "cards" : "list"}
						options={[
							{ value: "list", label: "List" },
							{ value: "cards", label: "Cards" },
						]}
						onValueChange={(value) => {
							const next = new URLSearchParams(params);
							next.set("view", value);
							setParams(next);
						}}
					/>
				}
			/>
			<MemoryFilters params={params} onChange={setParams} />
			<LibraryBulkActions
				memories={state.items}
				selected={selected}
				onComplete={async (succeeded) => {
					setParams(
						setSelection(
							params,
							selected.filter((id) => !succeeded.includes(id)),
						),
					);
					await model.load(new URLSearchParams(query));
				}}
			/>
			<Feedback
				error={state.error}
				loading={state.loading}
				retry={() => void model.load(new URLSearchParams(query))}
			/>
			{!state.loading && !state.error && !state.items.length && (
				<LayerCard>
					<LayerCard.Empty
						title="No memories found"
						description="Try clearing filters or choosing a different space."
					/>
				</LayerCard>
			)}
			{cards ? (
				<div className="octo-memory-cards">
					{state.items.map((memory) => (
						<LayerCard key={memory.id}>
							<LayerCard.Header className="octo-actions">{row(memory)}</LayerCard.Header>
							<LayerCard.Body className="octo-memory-stack">
								<MemoryTags memory={memory} />
								<p>{memory.body.slice(0, 180)}</p>
								<time className="octo-muted" dateTime={memory.updated_at}>
									{new Date(memory.updated_at).toLocaleString()}
								</time>
							</LayerCard.Body>
						</LayerCard>
					))}
				</div>
			) : (
				state.items.length > 0 && (
					<LayerCard>
						<div className="octo-memory-overflow">
							<Table aria-label="Memories">
								<TableHeader>
									<TableRow>
										<TableHead>
											<Checkbox
												aria-label="Select current page"
												checked={state.items.every((item) => selected.includes(item.id))}
												onCheckedChange={(checked) =>
													setParams(
														setSelection(
															params,
															checked
																? [...new Set([...selected, ...state.items.map((item) => item.id)])]
																: selected.filter(
																		(id) => !state.items.some((item) => item.id === id),
																	),
														),
													)
												}
											/>
										</TableHead>
										<TableHead>Title</TableHead>
										<TableHead>Space / tags</TableHead>
										<TableHead>Updated</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{state.items.map((memory) => (
										<TableRow
											key={memory.id}
											variant={selected.includes(memory.id) ? "selected" : "default"}
										>
											<TableCell>
												<Checkbox
													aria-label={`Select ${memory.title}`}
													checked={selected.includes(memory.id)}
													onCheckedChange={(checked) => select(memory.id, checked === true)}
												/>
											</TableCell>
											<TableCell>
												<MemoryLink
													memoryId={memory.id}
													memoryTitle={memory.title}
													data-memory-link={memory.id}
												>
													{memory.title}
												</MemoryLink>
											</TableCell>
											<TableCell>
												<MemoryTags memory={memory} />
											</TableCell>
											<TableCell>
												<time dateTime={memory.updated_at}>
													{new Date(memory.updated_at).toLocaleString()}
												</time>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</LayerCard>
				)
			)}
			<div className="octo-actions">
				<span className="octo-muted">{state.items.length} on this page</span>
				<Choice
					label="Page size"
					value={params.get("limit") ?? "50"}
					options={["20", "50", "100", "200"]}
					onChange={(limit) => {
						const next = new URLSearchParams(params);
						next.set("limit", limit);
						next.delete("cursor");
						setParams(next);
					}}
				/>
				<Button
					variant="outline"
					disabled={!params.has("cursor") || state.loading}
					onClick={() => {
						const next = new URLSearchParams(params);
						next.delete("cursor");
						next.delete("selected");
						setParams(next);
					}}
				>
					First page
				</Button>
				<Button
					variant="outline"
					disabled={!state.nextCursor || state.loading}
					onClick={() => {
						const next = new URLSearchParams(params);
						next.set("cursor", state.nextCursor as string);
						next.delete("selected");
						setParams(next);
					}}
				>
					Next page
				</Button>
			</div>
		</div>
	);
}

export function MemoryPage() {
	const location = useLocation();
	const cachedTitle = (location.state as { memoryTitle?: string } | null)?.memoryTitle;
	const { id = "" } = useParams();
	const navigate = useNavigate();
	const model = useMemo(() => new MemoryModel(id), [id]);
	const state = useModel(model);
	const [tocOpen, setTocOpen] = useState(false);
	const entries = useMemo(() => markdownContents(state.memory?.body ?? ""), [state.memory?.body]);
	useEffect(() => {
		void model.load();
		const refresh = setInterval(() => {
			for (const attachment of Object.keys(model.state.urls))
				void model.attachmentUrl(attachment).catch(() => undefined);
		}, 240_000);
		return () => clearInterval(refresh);
	}, [model]);
	useEffect(() => {
		function key(event: KeyboardEvent) {
			if (
				event.key === "e" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.defaultPrevented &&
				!(
					event.target instanceof HTMLElement &&
					event.target.closest("input,textarea,[contenteditable=true]")
				)
			)
				navigate(`/memories/${id}/edit`);
		}
		document.addEventListener("keydown", key);
		return () => document.removeEventListener("keydown", key);
	}, [id, navigate]);
	const memory = state.memory;
	return (
		<div className="octo-page">
			<PageHeader
				size="xl"
				title={<span style={memoryTransition(id)}>{memory?.title ?? cachedTitle ?? "Memory"}</span>}
				description={memory ? `Version ${memory.version} / ${memory.space}` : "Private knowledge"}
				actions={
					<>
						<Button asChild variant="outline">
							<Link to={`/memories/${id}/history`}>Version history</Link>
						</Button>
						<Button asChild>
							<Link to={`/memories/${id}/edit`}>Edit memory</Link>
						</Button>
					</>
				}
			/>
			<Feedback error={state.error} loading={state.loading} retry={() => void model.load()} />
			{memory && (
				<>
					<MemoryTags memory={memory} />
					<div className="octo-memory-mobile">
						<Button variant="outline" onClick={() => setTocOpen(true)}>
							On this page
						</Button>
					</div>
					<div className="octo-memory-layout">
						<LayerCard>
							<LayerCard.Body>
								<Markdown
									source={memory.body}
									urls={state.urls}
									onAttachment={(attachment) => model.attachmentUrl(attachment)}
								/>
							</LayerCard.Body>
						</LayerCard>
						<aside className="octo-memory-aside">
							<div className="octo-memory-desktop octo-memory-toc">
								<MarkdownContents entries={entries} />
							</div>
							<LayerCard>
								<LayerCard.Header>Details</LayerCard.Header>
								<LayerCard.Body>
									<DescriptionList columns={1}>
										<DescriptionList.Item term="Importance">
											{memory.importance}
										</DescriptionList.Item>
										<DescriptionList.Item term="Created">
											{new Date(memory.created_at).toLocaleString()}
										</DescriptionList.Item>
										<DescriptionList.Item term="Updated">
											{new Date(memory.updated_at).toLocaleString()}
										</DescriptionList.Item>
										<DescriptionList.Item term="Event time">
											{memory.event_time ?? "Not set"}
										</DescriptionList.Item>
										<DescriptionList.Item term="Source">
											{memory.source_key_id ?? "Dashboard"}
										</DescriptionList.Item>
									</DescriptionList>
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>Attachments</LayerCard.Header>
								<LayerCard.Body className="octo-memory-stack">
									{(memory.attachments ?? []).map((attachment) => (
										<Button
											key={attachment.id}
											variant="link"
											onClick={() => {
												void model
													.attachmentUrl(attachment.id)
													.then((url) => window.location.assign(url))
													.catch(() => toast.error("Unable to load attachment"));
											}}
										>
											{attachment.filename} ({Math.ceil(attachment.size_bytes / 1024)} KB)
										</Button>
									))}
									{!memory.attachments?.length && (
										<span className="octo-muted">No attachments</span>
									)}
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>Version timeline</LayerCard.Header>
								<LayerCard.Body>
									<ol>
										{[...state.versions].reverse().map((version) => (
											<li key={version.version}>
												<Link
													to={`/memories/${id}/history?from=${Math.max(1, version.version - 1)}&to=${version.version}`}
												>
													v{version.version} / {version.op}
												</Link>
												<p className="octo-muted">
													{version.actor} / {new Date(version.created_at).toLocaleString()}
												</p>
											</li>
										))}
									</ol>
								</LayerCard.Body>
							</LayerCard>
						</aside>
					</div>
					<Sheet open={tocOpen} onOpenChange={setTocOpen}>
						<SheetContent>
							<SheetTitle>On this page</SheetTitle>
							<MarkdownContents entries={entries} onNavigate={() => setTocOpen(false)} />
						</SheetContent>
					</Sheet>
				</>
			)}
		</div>
	);
}

function ConflictDialog({ model }: { model: EditorModel }) {
	const state = useModel(model);
	const conflict = state.conflict;
	return (
		<Dialog
			open={Boolean(conflict)}
			onOpenChange={(open) => {
				if (!open) model.cancelMerge();
			}}
		>
			<DialogContent size="xl" disablePointerDismissal>
				<DialogTitle>Resolve version conflict</DialogTitle>
				<DialogDescription>
					Your original version, unsaved edits and the latest server version. Independent changes
					are merged; resolve every overlapping field before saving.
				</DialogDescription>
				{conflict && (
					<div className="octo-memory-stack">
						{conflict.fields.map((field) => (
							<LayerCard key={field}>
								<LayerCard.Header>
									{field}
									{conflict.unresolved.includes(field) ? " / needs resolution" : " / resolved"}
								</LayerCard.Header>
								<LayerCard.Body className="octo-memory-stack">
									<div className="octo-memory-conflict-grid">
										{(["base", "mine", "theirs"] as const).map((side) => (
											<section key={side}>
												<strong>{side}</strong>
												<pre>
													{typeof conflict[side][field] === "string"
														? conflict[side][field]
														: JSON.stringify(conflict[side][field], null, 2)}
												</pre>
											</section>
										))}
									</div>
									<div className="octo-actions">
										<Button
											variant="outline"
											aria-label={`Use mine: ${field}`}
											onClick={() => model.resolveField(field, conflict.mine[field])}
										>
											Use mine
										</Button>
										<Button
											variant="outline"
											aria-label={`Use theirs: ${field}`}
											onClick={() => model.resolveField(field, conflict.theirs[field])}
										>
											Use theirs
										</Button>
									</div>
									{field === "body" && (
										<Field label="Merged body" htmlFor="merged-body">
											<InputArea
												id="merged-body"
												value={conflict.merged.body}
												rows={8}
												onChange={(event) => model.resolveField("body", event.target.value)}
											/>
										</Field>
									)}
								</LayerCard.Body>
							</LayerCard>
						))}
						{!conflict.fields.length && (
							<p>All changes merge cleanly. Apply the merge, review, then save.</p>
						)}
						<Button disabled={conflict.unresolved.length > 0} onClick={() => model.finishMerge()}>
							Apply merge
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function EditorPage() {
	const { id = "" } = useParams();
	const [params, setParams] = useSearchParams();
	const model = useMemo(() => new EditorModel(id), [id]);
	const state = useModel(model);
	const pendingChanges = model.hasPendingChanges;
	const blocker = useBlocker(({ currentLocation, nextLocation }) =>
		model.blocksNavigation(currentLocation.pathname, nextLocation.pathname),
	);
	useEffect(() => {
		if (blocker.state === "blocked" && !pendingChanges) blocker.proceed();
	}, [blocker, pendingChanges]);
	const reader = useMemo(() => new MemoryModel(id), [id]);
	const attachments = useModel(reader);
	useEffect(() => {
		void model.load();
		void reader.load();
	}, [model, reader]);
	useEffect(() => {
		function key(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key === "s") {
				event.preventDefault();
				void model.save();
			}
		}
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [model]);
	useEffect(() => {
		function beforeUnload(event: BeforeUnloadEvent) {
			if (model.hasPendingChanges) event.preventDefault();
		}
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [model]);
	useEffect(() => {
		if (state.notice) toast.success(state.notice);
	}, [state.notice]);
	const draft = state.draft;
	async function upload(files: File[]) {
		for (const file of files) await model.upload(file);
		await reader.load();
	}
	return (
		<div className="octo-page">
			<PageHeader
				title="Edit memory"
				description={
					state.base
						? `Based on version ${state.base.version}${state.dirty ? " / unsaved changes" : ""}`
						: "Markdown editor"
				}
				actions={
					<>
						<Button asChild variant="outline">
							<Link to={`/memories/${id}`}>Read memory</Link>
						</Button>
						<Button
							onClick={() => void model.save()}
							loading={state.saving}
							disabled={!draft || state.uploading || Boolean(state.conflict)}
						>
							Save memory
						</Button>
					</>
				}
			/>
			<Feedback
				error={state.error}
				loading={state.loading}
				retry={() => {
					if (!state.dirty) void model.load();
					else void model.save();
				}}
			/>
			{draft && (
				<>
					<div className="octo-memory-fields">
						<Field label="Title" htmlFor="memory-title" required>
							<Input
								id="memory-title"
								value={draft.title}
								maxLength={500}
								required
								onChange={(event) => model.update({ title: event.target.value })}
							/>
						</Field>
						<Field label="Space" htmlFor="memory-space" required>
							<Input
								id="memory-space"
								value={draft.space}
								required
								onChange={(event) => model.update({ space: event.target.value })}
							/>
						</Field>
						<Choice
							label="Type"
							value={draft.type}
							options={MEMORY_TYPES}
							onChange={(type) => model.update({ type })}
						/>
						<Field label="Tags" htmlFor="memory-tags">
							<Input
								key={`${id}-${state.base?.version}`}
								id="memory-tags"
								defaultValue={draft.tags.join(", ")}
								onChange={(event) =>
									model.update({
										tags: event.target.value
											.split(",")
											.map((tag) => tag.trim())
											.filter(Boolean),
									})
								}
							/>
						</Field>
						<Field label="Importance" htmlFor="memory-importance">
							<Input
								id="memory-importance"
								type="number"
								min={0}
								max={1}
								step={0.01}
								value={draft.importance}
								onChange={(event) => model.update({ importance: event.target.valueAsNumber })}
							/>
						</Field>
						<Field
							label="Event time (UTC)"
							htmlFor="memory-event"
							hint="ISO 8601 UTC, blank clears it"
						>
							<Input
								id="memory-event"
								value={draft.event_time ?? ""}
								onChange={(event) => model.update({ event_time: event.target.value || null })}
							/>
						</Field>
					</div>
					<div className="octo-memory-mobile">
						<SegmentControl
							legend="Editor pane"
							value={params.get("pane") ?? "write"}
							options={[
								{ value: "write", label: "Write" },
								{ value: "preview", label: "Preview" },
							]}
							onValueChange={(pane) => {
								const next = new URLSearchParams(params);
								next.set("pane", pane);
								setParams(next, { replace: true });
							}}
						/>
					</div>
					<div className="octo-memory-editor" data-pane={params.get("pane") ?? "write"}>
						<Field label="Markdown body" htmlFor="memory-body" required>
							<InputArea
								id="memory-body"
								value={draft.body}
								rows={24}
								onChange={(event) => model.update({ body: event.target.value })}
								onPaste={(event) => {
									const files = [...event.clipboardData.files];
									if (files.length) {
										event.preventDefault();
										void upload(files);
									}
								}}
								onDragOver={(event) => {
									if (event.dataTransfer.types.includes("Files")) event.preventDefault();
								}}
								onDrop={(event) => {
									const files = [...event.dataTransfer.files];
									if (files.length) {
										event.preventDefault();
										void upload(files);
									}
								}}
							/>
						</Field>
						<LayerCard>
							<LayerCard.Header>Live preview</LayerCard.Header>
							<LayerCard.Body>
								<Markdown
									source={draft.body}
									urls={attachments.urls}
									onAttachment={(attachment) => reader.attachmentUrl(attachment)}
								/>
							</LayerCard.Body>
						</LayerCard>
					</div>
					<FileDropzone
						label="Upload attachments"
						description="Paste or drop images and PDF files. Up to 50 MiB each."
						accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf"
						maxSize={50 * 1024 * 1024}
						disabled={state.uploading || state.saving || Boolean(state.conflict)}
						onFilesAccepted={(files) => void upload(files)}
					/>
					{state.uploading && <p role="status">Uploading attachment...</p>}
				</>
			)}
			<ConflictDialog model={model} />
			<ConfirmDialog
				open={blocker.state === "blocked"}
				onOpenChange={(open) => {
					if (!open && blocker.state === "blocked") blocker.reset();
				}}
				title="Discard unsaved changes?"
				description="Your unsaved draft will be lost. Stay here to review or save it."
				confirmLabel="Discard changes"
				cancelLabel="Keep editing"
				variant="destructive"
				loading={state.saving || state.uploading}
				onConfirm={() => {
					if (blocker.state === "blocked") blocker.proceed();
				}}
			/>
		</div>
	);
}

export function HistoryPage() {
	const { id = "" } = useParams();
	const [params, setParams] = useSearchParams();
	const model = useMemo(() => new HistoryModel(id), [id]);
	const state = useModel(model);
	const from = Number(params.get("from"));
	const to = Number(params.get("to"));
	useEffect(() => {
		void model.loadFromUrl(params).then(() => {
			if (!model.state.error && model.state.current && (!params.has("from") || !params.has("to"))) {
				const next = new URLSearchParams(params);
				if (!params.has("from"))
					next.set(
						"from",
						String(model.state.versions.at(-2)?.version ?? model.state.current.version),
					);
				if (!params.has("to")) next.set("to", String(model.state.current.version));
				setParams(next, { replace: true });
			}
		});
	}, [model, params, setParams]);
	useEffect(() => {
		if (state.notice) toast.success(state.notice);
	}, [state.notice]);
	return (
		<div className="octo-page">
			<PageHeader
				title="Version history"
				description={state.current?.title ?? "Every write is a recoverable snapshot."}
				actions={
					<Button asChild variant="outline">
						<Link to={`/memories/${id}`}>Read memory</Link>
					</Button>
				}
			/>
			<Feedback
				error={state.error}
				loading={state.loading}
				retry={() => void model.loadFromUrl(params)}
			/>
			<div className="octo-actions">
				<Choice
					label="From version"
					value={String(from || state.versions[0]?.version || 1)}
					options={state.versions.map((version) => String(version.version))}
					onChange={(value) => {
						const next = new URLSearchParams(params);
						next.set("from", value);
						if (!to) next.set("to", String(state.current?.version ?? 1));
						setParams(next);
					}}
				/>
				<Choice
					label="To version"
					value={String(to || state.current?.version || 1)}
					options={state.versions.map((version) => String(version.version))}
					onChange={(value) => {
						const next = new URLSearchParams(params);
						next.set("to", value);
						if (!from) next.set("from", String(state.versions[0]?.version ?? 1));
						setParams(next);
					}}
				/>
				<SegmentControl
					legend="Diff layout"
					value={params.get("diff") ?? "inline"}
					options={[
						{ value: "inline", label: "Inline" },
						{ value: "split", label: "Side by side" },
					]}
					onValueChange={(value) => {
						const next = new URLSearchParams(params);
						next.set("diff", value);
						setParams(next, { replace: true });
					}}
				/>
			</div>
			{state.diff && (
				<LayerCard>
					<LayerCard.Header>
						Changes / v{state.diff.from} to v{state.diff.to}
					</LayerCard.Header>
					<LayerCard.Body className="octo-memory-stack">
						{state.diff.fields
							.filter((field) => field.field !== "body")
							.map((field) => (
								<section key={field.field}>
									<strong>{field.field}</strong>
									<div className="octo-memory-editor">
										<pre>{JSON.stringify(field.from, null, 2)}</pre>
										<pre>{JSON.stringify(field.to, null, 2)}</pre>
									</div>
								</section>
							))}
						<div className="octo-memory-overflow">
							<Table className="octo-memory-diff" aria-label="Body diff">
								<TableHeader>
									<TableRow>
										<TableHead>Old</TableHead>
										<TableHead>New</TableHead>
										{params.get("diff") === "split" ? (
											<>
												<TableHead>Before</TableHead>
												<TableHead>After</TableHead>
											</>
										) : (
											<TableHead>Change</TableHead>
										)}
									</TableRow>
								</TableHeader>
								<TableBody>
									{diffLines(state.diff.body.hunks).map((line) => (
										<TableRow key={line.key} data-change={line.kind}>
											<TableCell>{line.oldLine}</TableCell>
											<TableCell>{line.newLine}</TableCell>
											{params.get("diff") === "split" ? (
												<>
													<TableCell>
														<code>{line.kind === "added" ? "" : line.text}</code>
													</TableCell>
													<TableCell>
														<code>{line.kind === "removed" ? "" : line.text}</code>
													</TableCell>
												</>
											) : (
												<TableCell>
													<code>
														{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
														{line.text}
													</code>
												</TableCell>
											)}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						{!state.diff.fields.length && <p>No changes between these versions.</p>}
					</LayerCard.Body>
				</LayerCard>
			)}
			<LayerCard>
				<LayerCard.Header>Snapshots</LayerCard.Header>
				<LayerCard.Body className="octo-memory-stack">
					{[...state.versions].reverse().map((version) => (
						<div className="octo-actions" key={version.version}>
							<strong>v{version.version}</strong>
							<span>
								{version.op} / {version.actor}
							</span>
							<time dateTime={version.created_at}>
								{new Date(version.created_at).toLocaleString()}
							</time>
							<Button
								variant="outline"
								aria-label={`Rollback to version ${version.version}`}
								disabled={version.version === state.current?.version || state.saving}
								onClick={() => model.requestRollback(version.version)}
							>
								Rollback
							</Button>
						</div>
					))}
				</LayerCard.Body>
			</LayerCard>
			<ConfirmDialog
				open={state.rollbackTarget !== null}
				onOpenChange={(open) => {
					if (!open) model.cancelRollback();
				}}
				title={`Rollback to version ${state.rollbackTarget}?`}
				description={
					<>
						This creates a new version; existing history is retained.
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				confirmLabel="Confirm rollback"
				loading={state.saving}
				onConfirm={async () => {
					const target = model.state.rollbackTarget;
					await model.rollback();
					if (model.state.notice && target !== null) {
						const next = new URLSearchParams(params);
						next.set("from", String(target));
						next.set("to", String(model.state.current?.version));
						setParams(next);
					}
				}}
			/>
		</div>
	);
}
