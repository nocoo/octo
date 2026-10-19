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
	Label,
	LayerCard,
	SegmentControl,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	SheetTrigger,
	toast,
} from "@nocoo/basalt";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nocoo/basalt/components/alert-dialog";
import { Banner } from "@nocoo/basalt/components/banner";
import { CodeBlock } from "@nocoo/basalt/components/code";
import { FileDropzone } from "@nocoo/basalt/components/file-dropzone";
import { Grid } from "@nocoo/basalt/components/grid";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import {
	BookOpen,
	ChevronRight,
	ChevronsLeft,
	CircleAlert,
	GitMerge,
	History,
	ListTree,
	Paperclip,
	Pencil,
	RotateCcw,
	Save,
	SearchX,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Link,
	useBlocker,
	useLocation,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router";
import { MEMORY_TYPES } from "../../lib/schema/memory";
import {
	Markdown,
	MarkdownContents,
	navigateToMarkdownHeading,
} from "../components/layout/markdown";
import { useModel } from "../components/layout/use-model";
import { selectedIds, setSelection } from "../viewmodels/library";
import {
	filterKeys,
	HistoryModel,
	MemoriesModel,
	type Memory,
	MemoryModel,
	memoryFieldLabels,
	memoryOperationLabels,
	memoryTypeLabels,
} from "../viewmodels/memories";
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
					role="alert"
					variant="error"
					icon={<CircleAlert aria-hidden="true" />}
					title="请求失败"
					description={error}
					action={
						<Banner.Action onClick={retry}>
							<RotateCcw aria-hidden="true" />
							重试
						</Banner.Action>
					}
				/>
			)}
			{loading && (
				<p role="status" className="octo-muted">
					正在加载…
				</p>
			)}
		</>
	);
}

function MemoryTags({ memory }: { memory: Pick<Memory, "tags" | "space" | "type"> }) {
	return (
		<Grid
			columns={1}
			gap="sm"
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: "var(--basalt-space-content-gap)",
				alignItems: "center",
				overflowWrap: "anywhere",
			}}
		>
			<TagBadge name={memory.space} size="sm" />
			<Badge variant="secondary">{memoryTypeLabels[memory.type] ?? "未知类型"}</Badge>
			{memory.tags.map((tag) => (
				<TagBadge key={tag} name={tag} size="sm" />
			))}
		</Grid>
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
					aria-label={`选择 ${memory.title}`}
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
		<Grid columns={1}>
			<MemoryFilters params={params} onChange={setParams}>
				{(filterTrigger) => (
					<PageHeader
						title={
							<span className="octo-page-title">
								<BookOpen className="octo-title-icon" aria-hidden="true" />
								记忆库
							</span>
						}
						actions={
							<>
								{filterTrigger}
								<SegmentControl
									legend="显示方式"
									value={cards ? "cards" : "list"}
									options={[
										{ value: "list", label: "列表" },
										{ value: "cards", label: "卡片" },
									]}
									onValueChange={(value) => {
										const next = new URLSearchParams(params);
										next.set("view", value);
										setParams(next);
									}}
								/>
							</>
						}
					/>
				)}
			</MemoryFilters>
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
			{state.loaded && !state.loading && !state.error && !state.items.length && (
				<LayerCard>
					<LayerCard.Empty
						className="octo-empty octo-empty--page"
						icon={<SearchX aria-hidden="true" />}
						title="没有找到记忆"
						description="清除筛选或刷新列表后再试。"
						action={
							<Button
								onClick={() => {
									const next = new URLSearchParams(params);
									for (const key of filterKeys) next.delete(key);
									next.delete("cursor");
									next.delete("selected");
									setParams(next);
									void model.load(next);
								}}
							>
								<RotateCcw aria-hidden="true" />
								刷新列表
							</Button>
						}
					/>
				</LayerCard>
			)}
			{cards ? (
				<Grid
					columns={1}
					style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 19rem), 1fr))" }}
				>
					{state.items.map((memory) => (
						<LayerCard key={memory.id}>
							<LayerCard.Header>{row(memory)}</LayerCard.Header>
							<LayerCard.Body style={{ display: "grid", gap: "var(--basalt-space-layout)" }}>
								<MemoryTags memory={memory} />
								<p>{memory.body.slice(0, 180)}</p>
								<time className="octo-muted" dateTime={memory.updated_at}>
									{new Date(memory.updated_at).toLocaleString("zh-CN")}
								</time>
							</LayerCard.Body>
						</LayerCard>
					))}
				</Grid>
			) : (
				state.items.length > 0 && (
					<LayerCard padding="none">
						<Grid columns={1} className="octo-memory-overflow">
							<Table className="octo-table" aria-label="记忆">
								<TableHeader>
									<TableRow>
										<TableHead className="ps-basalt-table-edge">
											<Checkbox
												aria-label="选择当前页"
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
										<TableHead style={{ minWidth: "28ch" }}>标题</TableHead>
										<TableHead style={{ minWidth: "28ch" }}>空间 / 标签</TableHead>
										<TableHead
											textAlign="end"
											className="pe-basalt-table-edge"
											style={{ minWidth: "24ch" }}
										>
											更新时间
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{state.items.map((memory) => (
										<TableRow
											key={memory.id}
											variant={selected.includes(memory.id) ? "selected" : "default"}
										>
											<TableCell className="ps-basalt-table-edge">
												<Checkbox
													aria-label={`选择 ${memory.title}`}
													checked={selected.includes(memory.id)}
													onCheckedChange={(checked) => select(memory.id, checked === true)}
												/>
											</TableCell>
											<TableCell style={{ minWidth: "28ch" }}>
												<MemoryLink
													memoryId={memory.id}
													memoryTitle={memory.title}
													data-memory-link={memory.id}
												>
													{memory.title}
												</MemoryLink>
											</TableCell>
											<TableCell style={{ minWidth: "28ch" }}>
												<MemoryTags memory={memory} />
											</TableCell>
											<TableCell
												textAlign="end"
												className="pe-basalt-table-edge"
												style={{ minWidth: "24ch" }}
											>
												<time dateTime={memory.updated_at}>
													{new Date(memory.updated_at).toLocaleString("zh-CN")}
												</time>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</Grid>
					</LayerCard>
				)
			)}
			<Grid
				columns={1}
				gap="sm"
				style={{
					gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
					alignItems: "center",
				}}
			>
				<span className="octo-muted">本页 {state.items.length} 条</span>
				<Choice
					label="每页条数"
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
					<ChevronsLeft aria-hidden="true" />
					第一页
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
					<ChevronRight aria-hidden="true" />
					下一页
				</Button>
			</Grid>
		</Grid>
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
	const tocTarget = useRef<string | null>(null);
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
		<Grid columns={1} className="octo-memory-reader">
			<PageHeader
				size="xl"
				title={
					<span style={{ viewTransitionName: memoryTransition(id) }}>
						{memory?.title ?? cachedTitle ?? "记忆"}
					</span>
				}
			/>
			<Sheet open={tocOpen} onOpenChange={setTocOpen}>
				<Grid
					columns={1}
					className="octo-memory-toolbar"
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: "var(--basalt-space-content-gap)",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					{memory && (
						<Grid
							columns={1}
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: "var(--basalt-space-content-gap)",
								alignItems: "center",
								flex: "1 1 18rem",
								minWidth: 0,
							}}
						>
							<span className="octo-muted">第 {memory.version} 版</span>
							<MemoryTags memory={memory} />
						</Grid>
					)}
					<Grid
						columns={1}
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "var(--basalt-space-content-gap)",
							alignItems: "center",
						}}
					>
						{memory && (
							<SheetTrigger asChild>
								<Button variant="outline" className="octo-memory-reader-compact">
									<ListTree aria-hidden="true" />
									本页目录
								</Button>
							</SheetTrigger>
						)}
						<Button asChild variant="outline">
							<Link to={`/memories/${id}/history`}>
								<History aria-hidden="true" />
								版本历史
							</Link>
						</Button>
						<Button asChild>
							<Link to={`/memories/${id}/edit`}>
								<Pencil aria-hidden="true" />
								编辑记忆
							</Link>
						</Button>
					</Grid>
				</Grid>
				<SheetContent
					onCloseAutoFocus={(event) => {
						const target = tocTarget.current;
						tocTarget.current = null;
						if (target && navigateToMarkdownHeading(target)) event.preventDefault();
					}}
				>
					<SheetTitle>本页目录</SheetTitle>
					<SheetDescription>选择标题，跳转到记忆中的对应章节。</SheetDescription>
					<MarkdownContents
						entries={entries}
						onNavigate={(target) => {
							tocTarget.current = target;
							setTocOpen(false);
						}}
					/>
				</SheetContent>
			</Sheet>
			<Feedback error={state.error} loading={state.loading} retry={() => void model.load()} />
			{memory && (
				<Grid
					columns={1}
					className="octo-memory-layout"
					style={{ gridTemplateColumns: "var(--octo-memory-columns)", alignItems: "start" }}
				>
					<LayerCard>
						<LayerCard.Body>
							<Markdown
								source={memory.body}
								urls={state.urls}
								onAttachment={(attachment) => model.attachmentUrl(attachment)}
							/>
						</LayerCard.Body>
					</LayerCard>
					<Grid columns={1} className="octo-memory-aside">
						<Grid columns={1} className="octo-memory-reader-wide octo-memory-toc">
							<MarkdownContents entries={entries} />
						</Grid>
						<LayerCard>
							<LayerCard.Header>详细信息</LayerCard.Header>
							<LayerCard.Body>
								<DescriptionList columns={1}>
									<DescriptionList.Item term="重要性">{memory.importance}</DescriptionList.Item>
									<DescriptionList.Item term="创建时间">
										{new Date(memory.created_at).toLocaleString("zh-CN")}
									</DescriptionList.Item>
									<DescriptionList.Item term="更新时间">
										{new Date(memory.updated_at).toLocaleString("zh-CN")}
									</DescriptionList.Item>
									<DescriptionList.Item term="事件时间">
										{memory.event_time ?? "未设置"}
									</DescriptionList.Item>
									<DescriptionList.Item term="来源">
										{memory.source_key_id ?? "控制台"}
									</DescriptionList.Item>
								</DescriptionList>
							</LayerCard.Body>
						</LayerCard>
						<LayerCard>
							<LayerCard.Header>附件</LayerCard.Header>
							{memory.attachments?.length ? (
								<LayerCard.Body style={{ display: "grid", gap: "var(--basalt-space-layout)" }}>
									{(memory.attachments ?? []).map((attachment) => (
										<Button
											key={attachment.id}
											variant="link"
											onClick={() => {
												void model
													.attachmentUrl(attachment.id)
													.then((url) => window.location.assign(url))
													.catch(() => toast.error("无法加载附件"));
											}}
										>
											{attachment.filename} ({Math.ceil(attachment.size_bytes / 1024)} KB)
										</Button>
									))}
								</LayerCard.Body>
							) : (
								<LayerCard.Empty
									className="octo-empty"
									icon={<Paperclip aria-hidden="true" />}
									title="暂无附件"
									description="添加图片或 PDF，补充这条记忆。"
									action={
										<Button asChild>
											<Link to={`/memories/${id}/edit`}>
												<Paperclip aria-hidden="true" />
												添加附件
											</Link>
										</Button>
									}
								/>
							)}
						</LayerCard>
						<LayerCard>
							<LayerCard.Header>版本时间线</LayerCard.Header>
							<LayerCard.Body>
								<ol>
									{[...state.versions].reverse().map((version) => (
										<li key={version.version}>
											<Link
												to={`/memories/${id}/history?from=${Math.max(1, version.version - 1)}&to=${version.version}`}
											>
												第 {version.version} 版 / {memoryOperationLabels[version.op] ?? "其他操作"}
											</Link>
											<p className="octo-muted">
												{version.actor === "admin" ? "管理员" : version.actor} /{" "}
												{new Date(version.created_at).toLocaleString("zh-CN")}
											</p>
										</li>
									))}
								</ol>
							</LayerCard.Body>
						</LayerCard>
					</Grid>
				</Grid>
			)}
		</Grid>
	);
}

function ConflictDialog({
	model,
	opener,
}: {
	model: EditorModel;
	opener: RefObject<HTMLElement | null>;
}) {
	const state = useModel(model);
	const conflict = state.conflict;
	return (
		<Dialog
			open={Boolean(conflict)}
			onOpenChange={(open) => {
				if (!open) model.cancelMerge();
			}}
		>
			<DialogContent
				size="xl"
				disablePointerDismissal
				onCloseAutoFocus={(event) => {
					if (opener.current?.isConnected) {
						event.preventDefault();
						opener.current.focus();
					}
				}}
			>
				<DialogTitle>解决版本冲突</DialogTitle>
				<DialogDescription>
					对比原始版本、未保存的修改和服务器上的最新版本。互不冲突的修改会自动合并；请处理所有冲突字段后再保存。
				</DialogDescription>
				{conflict && (
					<Grid columns={1}>
						{conflict.fields.map((field) => (
							<LayerCard key={field}>
								<LayerCard.Header>
									{memoryFieldLabels[field]}
									{conflict.unresolved.includes(field) ? " / 待处理" : " / 已解决"}
								</LayerCard.Header>
								<LayerCard.Body style={{ display: "grid", gap: "var(--basalt-space-layout)" }}>
									<Grid
										columns={1}
										className="octo-memory-conflict-grid"
										style={{
											gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
										}}
									>
										{(["base", "mine", "theirs"] as const).map((side) => (
											<SectionRule
												key={side}
												title={{ base: "原始版本", mine: "我的修改", theirs: "最新版本" }[side]}
											>
												<LayerCard.Well>
													<pre>
														{field === "type"
															? (memoryTypeLabels[conflict[side].type] ?? "未知类型")
															: typeof conflict[side][field] === "string"
																? conflict[side][field]
																: JSON.stringify(conflict[side][field], null, 2)}
													</pre>
												</LayerCard.Well>
											</SectionRule>
										))}
									</Grid>
									<Grid
										columns={1}
										gap="sm"
										style={{
											gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
											alignItems: "center",
										}}
									>
										<Button
											variant="outline"
											aria-label={`使用我的修改：${memoryFieldLabels[field]}`}
											onClick={() => model.resolveField(field, conflict.mine[field])}
										>
											使用我的修改
										</Button>
										<Button
											variant="outline"
											aria-label={`使用最新版本：${memoryFieldLabels[field]}`}
											onClick={() => model.resolveField(field, conflict.theirs[field])}
										>
											使用最新版本
										</Button>
									</Grid>
									{field === "body" && (
										<Field label="合并后的正文" htmlFor="merged-body">
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
						{!conflict.fields.length && <p>所有修改均可自动合并。应用合并后，请检查内容并保存。</p>}
						<Button disabled={conflict.unresolved.length > 0} onClick={() => model.finishMerge()}>
							<GitMerge aria-hidden="true" />
							应用合并
						</Button>
					</Grid>
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
	const conflictOpener = useRef<HTMLElement | null>(null);
	const save = useCallback(() => {
		if (model.state.saving || model.state.uploading || model.state.conflict) return;
		conflictOpener.current =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		void model.save();
	}, [model]);
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
				save();
			}
		}
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [save]);
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
	useEffect(() => {
		if (state.error) toast.error(state.error, { id: "memory-editor-error" });
		else toast.dismiss("memory-editor-error");
	}, [state.error]);
	const draft = state.draft;
	async function upload(files: File[]) {
		for (const file of files) await model.upload(file);
		await reader.load();
	}
	return (
		<Grid columns={1}>
			<PageHeader
				title="编辑记忆"
				description={
					state.base
						? `基于第 ${state.base.version} 版${state.dirty ? " / 有未保存的修改" : ""}`
						: "Markdown 编辑器"
				}
				actions={
					<>
						<Button asChild variant="outline">
							<Link to={`/memories/${id}`}>
								<BookOpen aria-hidden="true" />
								查看记忆
							</Link>
						</Button>
						<Button
							onClick={(event) => {
								event.currentTarget.focus();
								save();
							}}
							loading={state.saving}
							disabled={!draft || state.uploading || Boolean(state.conflict)}
						>
							<Save aria-hidden="true" />
							保存记忆
						</Button>
					</>
				}
			/>
			<Feedback
				error={state.error}
				loading={state.loading}
				retry={() => {
					if (!state.dirty) void model.load();
					else save();
				}}
			/>
			{draft && (
				<>
					<Grid
						columns={1}
						className="octo-memory-metadata"
						style={{
							gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
							alignItems: "start",
						}}
					>
						<Field label="标题" htmlFor="memory-title" required style={{ gridColumn: "1 / -1" }}>
							<Input
								id="memory-title"
								value={draft.title}
								maxLength={500}
								required
								onChange={(event) => model.update({ title: event.target.value })}
							/>
						</Field>
						<Field label="空间" htmlFor="memory-space" required>
							<Input
								id="memory-space"
								value={draft.space}
								required
								onChange={(event) => model.update({ space: event.target.value })}
							/>
						</Field>
						<Choice
							label="类型"
							value={draft.type}
							options={MEMORY_TYPES}
							onChange={(type) => model.update({ type })}
						/>
						<Field label="标签" htmlFor="memory-tags">
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
						<Field label="重要性" htmlFor="memory-importance">
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
							label="事件时间（UTC）"
							htmlFor="memory-event"
							hint="使用 ISO 8601 UTC 格式，留空即清除"
						>
							<Input
								id="memory-event"
								value={draft.event_time ?? ""}
								onChange={(event) => model.update({ event_time: event.target.value || null })}
							/>
						</Field>
					</Grid>
					<Grid columns={1} className="octo-memory-mobile">
						<SegmentControl
							legend="编辑面板"
							value={params.get("pane") ?? "write"}
							options={[
								{ value: "write", label: "编辑" },
								{ value: "preview", label: "预览" },
							]}
							onValueChange={(pane) => {
								const next = new URLSearchParams(params);
								next.set("pane", pane);
								setParams(next, { replace: true });
							}}
						/>
					</Grid>
					<Grid
						columns={1}
						className="octo-memory-editor"
						style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))" }}
						data-pane={params.get("pane") ?? "write"}
					>
						<LayerCard>
							<LayerCard.Header asChild>
								<Label htmlFor="memory-body">Markdown 正文</Label>
							</LayerCard.Header>
							<LayerCard.Body>
								<InputArea
									required
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
							</LayerCard.Body>
						</LayerCard>
						<LayerCard>
							<LayerCard.Header>实时预览</LayerCard.Header>
							<LayerCard.Body>
								<Markdown
									source={draft.body}
									urls={attachments.urls}
									onAttachment={(attachment) => reader.attachmentUrl(attachment)}
								/>
							</LayerCard.Body>
						</LayerCard>
					</Grid>
					<FileDropzone
						label="上传附件"
						description="粘贴或拖入图片、PDF 文件，每个文件不超过 50 MiB。"
						browseLabel="选择文件"
						dropLabel="将文件拖到这里"
						formatRejection={({ file, code }) =>
							`${file.name}：${
								{
									"file-invalid-type": "不支持的文件类型",
									"file-too-large": "文件大小不能超过 50 MiB",
									"too-many-files": "文件数量过多",
								}[code]
							}`
						}
						accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf"
						maxSize={50 * 1024 * 1024}
						disabled={state.uploading || state.saving || Boolean(state.conflict)}
						onFilesAccepted={(files) => void upload(files)}
					/>
					{state.uploading && <p role="status">正在上传附件…</p>}
				</>
			)}
			<ConflictDialog model={model} opener={conflictOpener} />
			<ConfirmDialog
				open={blocker.state === "blocked"}
				onOpenChange={(open) => {
					if (!open && blocker.state === "blocked") blocker.reset();
				}}
				title="放弃未保存的修改？"
				description="未保存的草稿将丢失。你可以留在当前页面检查或保存。"
				confirmLabel="放弃修改"
				cancelLabel="继续编辑"
				variant="destructive"
				loading={state.saving || state.uploading}
				onConfirm={() => {
					if (blocker.state === "blocked") blocker.proceed();
				}}
			/>
		</Grid>
	);
}

export function HistoryPage() {
	const { id = "" } = useParams();
	const [params, setParams] = useSearchParams();
	const model = useMemo(() => new HistoryModel(id), [id]);
	const state = useModel(model);
	const rollbackOpener = useRef<HTMLElement | null>(null);
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
		<Grid columns={1}>
			<PageHeader
				title="版本历史"
				description={state.current?.title ?? "每次写入都会保留可恢复的版本快照。"}
				actions={
					<Button asChild variant="outline">
						<Link to={`/memories/${id}`}>
							<BookOpen aria-hidden="true" />
							查看记忆
						</Link>
					</Button>
				}
			/>
			<Feedback
				error={state.error}
				loading={state.loading}
				retry={() => void model.loadFromUrl(params)}
			/>
			<Grid
				columns={1}
				gap="sm"
				style={{
					gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
					alignItems: "center",
				}}
			>
				<Choice
					label="起始版本"
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
					label="目标版本"
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
					legend="差异显示方式"
					value={params.get("diff") ?? "inline"}
					options={[
						{ value: "inline", label: "行内" },
						{ value: "split", label: "并排" },
					]}
					onValueChange={(value) => {
						const next = new URLSearchParams(params);
						next.set("diff", value);
						setParams(next, { replace: true });
					}}
				/>
			</Grid>
			{state.diff && (
				<LayerCard>
					<LayerCard.Header>
						变更 / 第 {state.diff.from} 版至第 {state.diff.to} 版
					</LayerCard.Header>
					<LayerCard.Body style={{ display: "grid", gap: "var(--basalt-space-layout)" }}>
						{state.diff.fields
							.filter((field) => field.field !== "body")
							.map((field) => (
								<SectionRule key={field.field} title={memoryFieldLabels[field.field] ?? "其他字段"}>
									<Grid
										columns={1}
										className="octo-memory-editor"
										style={{
											gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))",
										}}
									>
										{(["from", "to"] as const).map((side) =>
											field[side] !== null && typeof field[side] === "object" ? (
												<CodeBlock
													key={side}
													title={side === "from" ? "修改前" : "修改后"}
													copyable={false}
												>
													{JSON.stringify(field[side], null, 2)}
												</CodeBlock>
											) : (
												<LayerCard.Well key={side}>
													<p className="octo-memory-value">
														{field.field === "type"
															? (memoryTypeLabels[String(field[side])] ?? "未知类型")
															: String(field[side] ?? "未设置")}
													</p>
												</LayerCard.Well>
											),
										)}
									</Grid>
								</SectionRule>
							))}
						<Grid columns={1} className="octo-memory-overflow">
							<Table className="octo-memory-diff" aria-label="正文差异">
								<TableHeader>
									<TableRow>
										<TableHead>旧行号</TableHead>
										<TableHead>新行号</TableHead>
										{params.get("diff") === "split" ? (
											<>
												<TableHead>修改前</TableHead>
												<TableHead>修改后</TableHead>
											</>
										) : (
											<TableHead>变更</TableHead>
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
						</Grid>
						{!state.diff.fields.length && <p>这两个版本之间没有差异。</p>}
					</LayerCard.Body>
				</LayerCard>
			)}
			<LayerCard>
				<LayerCard.Header>版本快照</LayerCard.Header>
				<LayerCard.Body style={{ display: "grid", gap: "var(--basalt-space-layout)" }}>
					{[...state.versions].reverse().map((version) => (
						<Grid
							columns={1}
							gap="sm"
							style={{
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
								alignItems: "center",
							}}
							key={version.version}
						>
							<strong>第 {version.version} 版</strong>
							<span>
								{memoryOperationLabels[version.op] ?? "其他操作"} /{" "}
								{version.actor === "admin" ? "管理员" : version.actor}
							</span>
							<time dateTime={version.created_at}>
								{new Date(version.created_at).toLocaleString("zh-CN")}
							</time>
							<Button
								variant="outline"
								aria-label={`回滚到第 ${version.version} 版`}
								disabled={version.version === state.current?.version || state.saving}
								onClick={(event) => {
									rollbackOpener.current = event.currentTarget;
									model.requestRollback(version.version);
								}}
							>
								<RotateCcw aria-hidden="true" />
								回滚
							</Button>
						</Grid>
					))}
				</LayerCard.Body>
			</LayerCard>
			<AlertDialog
				open={state.rollbackTarget !== null}
				onOpenChange={(open) => {
					if (!open && !state.saving) model.cancelRollback();
				}}
			>
				<AlertDialogContent
					onCloseAutoFocus={(event) => {
						if (rollbackOpener.current?.isConnected) {
							event.preventDefault();
							rollbackOpener.current.focus();
						}
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>回滚到第 {state.rollbackTarget} 版？</AlertDialogTitle>
						<AlertDialogDescription>
							此操作会创建新版本，已有历史记录将保留。
						</AlertDialogDescription>
					</AlertDialogHeader>
					{state.error && (
						<Banner role="alert" variant="error" title="回滚失败" description={state.error} />
					)}
					<AlertDialogFooter>
						<AlertDialogCancel asChild>
							<Button variant="outline" disabled={state.saving}>
								取消
							</Button>
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								loading={state.saving}
								onClick={async (event) => {
									event.preventDefault();
									if (model.state.saving) return;
									const target = model.state.rollbackTarget;
									await model.rollback();
									if (model.state.notice && target !== null) {
										const next = new URLSearchParams(params);
										next.set("from", String(target));
										next.set("to", String(model.state.current?.version));
										setParams(next);
									}
								}}
							>
								确认回滚
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Grid>
	);
}
