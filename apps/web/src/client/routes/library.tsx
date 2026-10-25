import {
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
	toast,
} from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { FilterBar, FilterChip } from "@nocoo/basalt/components/filter-bar";
import { Grid } from "@nocoo/basalt/components/grid";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import { Text } from "@nocoo/basalt/components/text";
import {
	AlertCircle,
	ArrowUpRight,
	CalendarDays,
	Check,
	FolderPlus,
	Network,
	Pencil,
	RefreshCw,
	RotateCcw,
	SlidersHorizontal,
	Tags,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../components/layout/page-header";
import { useModel } from "../components/layout/use-model";
import { SpaceLink, ViewSwitch } from "../components/record-display";
import { formatNumber } from "../lib/format";
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
	graphOptions,
	timelineOptions,
	updateLibraryUrl,
} from "../viewmodels/library-visualizations";
import { GraphTables } from "./library-graph-tables";
import { TimelineRecords } from "./library-timeline";
import { SpaceRenameForm } from "./space-rename";

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

function LibraryStatus({
	state,
	onRetry,
	hideError = false,
}: {
	state: LibraryState;
	onRetry: () => void;
	hideError?: boolean;
}) {
	return (
		<>
			{!state.ready && !state.error && <p role="status">正在加载资料库…</p>}
			{state.error && !hideError && (
				<p role="alert">
					<AlertCircle className="inline" size={16} aria-hidden="true" /> {state.error}{" "}
					<Button size="sm" variant="outline" onClick={onRetry} disabled={state.busy}>
						<RefreshCw size={16} aria-hidden="true" />
						重试
					</Button>
				</p>
			)}
			{state.notice && (
				<p role="status" className="text-basalt-sm text-basalt-muted-foreground">
					<Check className="inline" size={16} aria-hidden="true" /> {state.notice}
				</p>
			)}
			{state.truncated && (
				<p role="status">
					当前展示前 {state.memories.length} 条记忆。图谱和时间线仅代表这些样本，而非整个资料库。
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
			<SelectTrigger title="按空间筛选" className="w-basalt-32 max-w-full">
				<SelectValue placeholder="全部空间" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="__all__">全部空间</SelectItem>
				{spaces.map((space) => (
					<SelectItem key={space} value={space}>
						{space}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function TagsPage() {
	const { model, state } = useLibrary("tags");
	const [params, setParams] = useSearchParams();
	const [operation, setOperation] = useState<"rename" | "merge">("rename");
	const [target, setTarget] = useState("");
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const opener = useRef<HTMLButtonElement | null>(null);
	const focusFallback = useRef<HTMLInputElement | null>(null);
	const restoreFocus = (event: Event) => {
		event.preventDefault();
		(opener.current?.isConnected ? opener.current : focusFallback.current)?.focus();
	};
	const source = state.tags.find((tag) => tag.name === params.get("tag"));
	const graph = useMemo(
		() => buildGraph(filterMemories(state.memories, params), "cooccurrence", 150),
		[state.memories, params],
	);
	const query = params.get("q") ?? "";
	const columns: DataTableColumn<LibraryTag>[] = [
		{
			id: "name",
			header: "标签",
			width: "24ch",
			accessor: (tag) => (
				<Link href={`/memories?${new URLSearchParams({ tags_all: tag.name })}`}>
					<TagBadge name={tag.display_name} colorKey={tag.name} size="sm" />
				</Link>
			),
			sortValue: (tag) => tag.name,
		},
		{
			id: "count",
			header: "记忆数",
			width: "10ch",
			accessor: (tag) => (
				<span className="font-medium text-basalt-tag-blue-foreground">
					{formatNumber(tag.use_count)}
				</span>
			),
			sortValue: (tag) => tag.use_count,
			textAlign: "end",
			cellClassName: "tabular-nums",
		},
		{
			id: "actions",
			header: "操作",
			width: "24ch",
			textAlign: "end",
			sortable: false,
			accessor: (tag) => (
				<Grid columns={2} gap="sm" style={{ display: "flex", justifyContent: "flex-end" }}>
					{(["rename", "merge"] as const).map((action) => (
						<Button
							key={action}
							size="sm"
							variant="outline"
							disabled={state.busy}
							onClick={(event) => {
								opener.current = event.currentTarget;
								setConfirmError(null);
								setParams(updateLibraryUrl(params, "tag", tag.name));
								setOperation(action);
								setTarget("");
							}}
							aria-label={`${action === "rename" ? "重命名" : "合并"} ${tag.display_name}`}
						>
							{action === "rename" ? (
								<Pencil size={16} aria-hidden="true" />
							) : (
								<Tags size={16} aria-hidden="true" />
							)}
							{action === "rename" ? "重命名" : "合并"}
						</Button>
					))}
				</Grid>
			),
		},
	];
	function close() {
		setConfirming(false);
		setParams(updateLibraryUrl(params, "tag", ""));
	}
	return (
		<Grid columns={1} gap="lg">
			<PageHeader
				title="标签"
				meta={state.ready ? `${state.tags.length} 个标签` : undefined}
				actions={
					<>
						<Input
							className="w-basalt-40 max-w-full"
							ref={focusFallback}
							aria-label="筛选标签"
							placeholder="查找标签"
							value={query}
							onChange={(event) => setParams(updateLibraryUrl(params, "q", event.target.value))}
						/>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							<RefreshCw size={16} aria-hidden="true" />
							刷新
						</Button>
					</>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} hideError={confirming} />
			{state.ready && (
				<>
					<LayerCard padding="none">
						<DataTable
							className="octo-table"
							aria-label="标签"
							data={state.tags}
							columns={columns}
							filter={query}
							getRowId={(tag) => tag.id}
							pageSize={25}
							edge="attached"
							loading={state.busy && !state.ready}
							empty={
								<LayerCard.Empty
									className="octo-empty octo-empty--page"
									icon={<Tags aria-hidden="true" />}
									title="没有符合搜索条件的标签。"
									action={
										query ? (
											<Button onClick={() => setParams(updateLibraryUrl(params, "q", ""))}>
												<RotateCcw size={16} aria-hidden="true" />
												清除筛选
											</Button>
										) : (
											<Button asChild>
												<Link href="/memories">
													<ArrowUpRight size={16} aria-hidden="true" />
													浏览记忆
												</Link>
											</Button>
										)
									}
								/>
							}
						/>
					</LayerCard>
					{graph.nodes.length > 0 && (
						<SectionRule
							variant="heading"
							title="标签共现"
							hint="每条连线表示同时包含这两个标签的记忆数。"
							actions={<Link href="/graph?mode=cooccurrence">探索图谱</Link>}
						>
							<LayerCard>
								<LayerCard.Body>
									<Grid columns={1}>
										<Suspense fallback={<p role="status">正在加载图谱…</p>}>
											<GraphCanvas graph={graph} />
										</Suspense>
										<GraphTables
											graph={graph}
											selected={params.get("node") ? [params.get("node") as string] : []}
											onSelected={(ids) =>
												setParams(updateLibraryUrl(params, "node", ids[0] ?? ""))
											}
										/>
									</Grid>
								</LayerCard.Body>
							</LayerCard>
						</SectionRule>
					)}
				</>
			)}
			<Dialog
				open={Boolean(source) && !confirming}
				onOpenChange={(open) => {
					if (!open && !state.busy) close();
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						if (confirming) {
							event.preventDefault();
							return;
						}
						restoreFocus(event);
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{operation === "rename" ? "重命名" : "合并"} {source?.display_name}
						</DialogTitle>
						<DialogDescription>此操作会修改所有空间中的同名标签。</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							setConfirming(true);
						}}
					>
						<Grid columns={1}>
							{operation === "rename" ? (
								<Field label="新标签名称" htmlFor="tag-target" required>
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
								<Field label="合并到" htmlFor="tag-target" required>
									<Select value={target} onValueChange={setTarget} disabled={state.busy}>
										<SelectTrigger id="tag-target">
											<SelectValue placeholder="选择已有标签" />
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
								影响 {source?.use_count ?? 0} 条记忆。{" "}
								{operation === "merge" && "重复标签会合并为一个。"}
							</p>
							<DialogFooter>
								<Button variant="outline" disabled={state.busy} onClick={close}>
									取消
								</Button>
								<Button type="submit" disabled={!target.trim() || target.trim() === source?.name}>
									确认修改内容
								</Button>
							</DialogFooter>
						</Grid>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				cancelLabel="取消"
				open={confirming && Boolean(source)}
				onOpenChange={(open) => {
					if (!open) close();
				}}
				title={`${operation === "rename" ? "重命名" : "合并"}所有空间中的标签？`}
				description={
					<>
						{source?.display_name} → {target}。当前用于 {source?.use_count ?? 0} 条未删除记忆；
						此操作也会影响回收站中的标签。
						{confirmError && (
							<Text as="span" role="alert" className="mt-basalt-space-sm block text-basalt-danger">
								操作失败：{confirmError}
							</Text>
						)}
					</>
				}
				loading={state.busy}
				onCloseAutoFocus={restoreFocus}
				confirmLabel={operation === "rename" ? "重命名标签" : "合并标签"}
				onConfirm={async () => {
					if (!source) return;
					setConfirmError(null);
					if (await model.changeTag(operation, source.name, target)) close();
					else setConfirmError(model.state.error ?? "请求失败，请稍后重试。");
				}}
			/>
		</Grid>
	);
}

export function SpacesPage() {
	const { model, state } = useLibrary("spaces");
	const [params, setParams] = useSearchParams();
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<LibrarySpace | null>(null);
	const [renameName, setRenameName] = useState("");
	const opener = useRef<HTMLButtonElement | null>(null);
	const filter = useRef<HTMLInputElement | null>(null);
	const openCreate = (button: HTMLButtonElement) => {
		opener.current = button;
		setCreateError(null);
		setCreating(true);
	};
	const columns: DataTableColumn<LibrarySpace>[] = [
		{
			id: "name",
			header: "空间",
			width: "24ch",
			accessor: (space) => <SpaceLink space={space.slug} name={space.name} />,
			sortValue: (space) => space.name,
		},
		{
			id: "slug",
			header: "标识",
			width: "22ch",
			sortValue: (space) => space.slug,
			accessor: (space) => (
				<span className="octo-record-id" title={space.slug}>
					{space.slug}
				</span>
			),
		},
		{
			id: "description",
			header: "说明",
			width: "26ch",
			sortValue: (space) => space.description,
			accessor: (space) => (
				<span className="octo-record-title octo-muted" title={space.description}>
					{space.description || "未填写"}
				</span>
			),
			wrap: true,
		},
		{
			id: "owner",
			header: "所属密钥",
			width: "24ch",
			accessor: (space) =>
				space.owner_key_id ? (
					<Link href="/keys" className="octo-record-title">
						{state.keys.find((key) => key.id === space.owner_key_id)?.name ?? space.owner_key_id}
					</Link>
				) : (
					"未指定"
				),
			sortValue: (space) => space.owner_key_id ?? "",
		},
		{
			id: "count",
			header: "记忆数",
			width: "10ch",
			accessor: (space) => (
				<span className="font-medium text-basalt-tag-blue-foreground">
					{formatNumber(space.memory_count)}
				</span>
			),
			sortValue: (space) => space.memory_count,
			textAlign: "end",
			cellClassName: "tabular-nums",
		},
		{
			id: "actions",
			header: "操作",
			textAlign: "end",
			width: "12ch",
			sortable: false,
			accessor: (space) => (
				<Button
					size="sm"
					variant="ghost"
					disabled={state.busy}
					aria-label={`重命名空间 ${space.name}`}
					onClick={(event) => {
						opener.current = event.currentTarget;
						model.resetSpaceRename();
						setRenameName(space.name);
						setRenaming(space);
					}}
				>
					<Pencil size={16} aria-hidden="true" />
					重命名
				</Button>
			),
		},
	];
	return (
		<Grid columns={1} gap="lg">
			<PageHeader
				title="空间"
				meta={state.ready ? `${state.spaces.length} 个空间` : undefined}
				actions={
					<>
						<Input
							className="w-basalt-28 max-w-full"
							aria-label="筛选空间"
							ref={filter}
							value={params.get("q") ?? ""}
							onChange={(event) => setParams(updateLibraryUrl(params, "q", event.target.value))}
							placeholder="查找空间"
						/>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							<RefreshCw size={16} aria-hidden="true" />
							刷新
						</Button>
						<Button onClick={(event) => openCreate(event.currentTarget)}>
							<FolderPlus size={16} aria-hidden="true" />
							创建空间
						</Button>
					</>
				}
			/>
			<LibraryStatus
				state={state}
				onRetry={() => void model.load()}
				hideError={creating || renaming !== null}
			/>
			{state.ready && (
				<LayerCard padding="none">
					<DataTable
						className="octo-table"
						aria-label="空间"
						data={state.spaces}
						columns={columns}
						filter={params.get("q") ?? ""}
						getRowId={(space) => space.id}
						pageSize={25}
						edge="attached"
						loading={state.busy && !state.ready}
						empty={
							<LayerCard.Empty
								className="octo-empty octo-empty--page"
								icon={<FolderPlus aria-hidden="true" />}
								title={params.get("q") ? "没有符合筛选条件的空间" : "还没有空间。"}
								description="创建空间，整理你的记忆。"
								action={
									<Button onClick={(event) => openCreate(event.currentTarget)}>
										<FolderPlus size={16} aria-hidden="true" />
										创建空间
									</Button>
								}
							/>
						}
					/>
				</LayerCard>
			)}
			<Dialog
				open={renaming !== null}
				onOpenChange={(open) => {
					if (!open && !state.busy) {
						setRenaming(null);
						model.resetSpaceRename();
					}
				}}
			>
				<DialogContent
					size="sm"
					onCloseAutoFocus={(event) => {
						const target = opener.current?.isConnected ? opener.current : filter.current;
						if (target?.isConnected) {
							event.preventDefault();
							target.focus();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>重命名空间</DialogTitle>
						<DialogDescription>仅修改显示名称，不会改变空间标识或其中的记忆。</DialogDescription>
					</DialogHeader>
					<SpaceRenameForm
						name={renameName}
						pending={state.busy}
						fieldError={state.renameFieldErrors.name ?? null}
						error={state.error}
						onChange={(name) => {
							setRenameName(name);
							model.resetSpaceRename();
						}}
						onCancel={() => {
							setRenaming(null);
							model.resetSpaceRename();
						}}
						onSubmit={async () => {
							if (renaming && (await model.renameSpace(renaming.slug, renameName)))
								setRenaming(null);
						}}
					/>
				</DialogContent>
			</Dialog>
			<Dialog
				open={creating}
				onOpenChange={(open) => {
					if (!open && state.busy) return;
					setCreating(open);
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						if (opener.current?.isConnected) {
							event.preventDefault();
							opener.current.focus();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>创建空间</DialogTitle>
						<DialogDescription>
							空间用于分类整理知识。所属密钥通过接口密钥权限管理。
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={async (event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const created = await model.createSpace({
								slug: String(form.get("slug")),
								name: String(form.get("name")),
								description: String(form.get("description")),
							});
							if (created) setCreating(false);
							else setCreateError(model.state.error ?? "请求失败，请稍后重试。");
						}}
					>
						<Grid columns={1}>
							<Field label="空间标识" htmlFor="space-slug" required>
								<Input
									id="space-slug"
									name="slug"
									required
									maxLength={64}
									disabled={state.busy}
									autoComplete="off"
								/>
							</Field>
							<Field label="名称" htmlFor="space-name" required>
								<Input id="space-name" name="name" required disabled={state.busy} />
							</Field>
							<Field label="说明" htmlFor="space-description">
								<Input id="space-description" name="description" disabled={state.busy} />
							</Field>
							{createError && (
								<Banner
									role="alert"
									variant="error"
									size="sm"
									title="创建失败"
									description={createError}
								/>
							)}
							<DialogFooter>
								<Button variant="outline" disabled={state.busy} onClick={() => setCreating(false)}>
									取消
								</Button>
								<Button type="submit" loading={state.busy}>
									创建空间
								</Button>
							</DialogFooter>
						</Grid>
					</form>
				</DialogContent>
			</Dialog>
		</Grid>
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
	const populated = state.ready && graph.nodes.length > 0;
	const meta = populated
		? `${graph.nodes.length} 个节点 · ${graph.links.length} 条关联${
				graph.clustered > 0 ? ` · 已聚合 ${graph.clustered} 个` : ""
			}`
		: undefined;
	return (
		<Grid columns={1} gap="lg" className={populated ? "octo-graph-page" : ""}>
			<PageHeader
				title="关系图"
				meta={meta}
				actions={
					<>
						<ViewSwitch
							label="关系类型"
							value={options.mode}
							onChange={(value) => setParams(updateLibraryUrl(params, "mode", value))}
							options={[
								{ value: "bipartite", label: "标签与记忆" },
								{ value: "cooccurrence", label: "标签共现" },
							]}
						/>
						<SpaceFilter
							memories={state.memories}
							value={params.get("space") ?? ""}
							onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
						/>
						<Input
							className="w-basalt-20"
							aria-label="节点上限"
							title="节点上限（10–500）"
							type="number"
							min={10}
							max={500}
							value={options.cap}
							onChange={(event) => setParams(updateLibraryUrl(params, "cap", event.target.value))}
						/>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							<RefreshCw size={16} aria-hidden="true" />
							刷新
						</Button>
					</>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			{state.ready && graph.nodes.length === 0 && (
				<LayerCard>
					<LayerCard.Empty
						className="octo-empty octo-empty--page"
						icon={<Network aria-hidden="true" />}
						title="暂无关系数据"
						description="添加记忆和标签后，可在这里查看关联。"
						action={
							<Button asChild>
								<Link href="/memories">
									<ArrowUpRight size={16} aria-hidden="true" />
									浏览记忆
								</Link>
							</Button>
						}
					/>
				</LayerCard>
			)}
			{populated && (
				<Suspense fallback={<LayerCard.Loading label="正在加载图谱…" />}>
					<GraphCanvas graph={graph} />
				</Suspense>
			)}
		</Grid>
	);
}

export function TimelinePage() {
	const { model, state } = useLibrary("timeline");
	const [params, setParams] = useSearchParams();
	const options = timelineOptions(params);
	const timeline = buildTimeline(filterMemories(state.memories, params), options);
	const table = params.get("view") === "table";
	const rangeField = (name: "from" | "to", label: string): ReactNode => (
		<Field label={label} htmlFor={`timeline-${name}`} hint="包含边界时刻的 UTC 时间。">
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
		<Grid columns={1} gap="lg">
			<Collapsible
				asChild
				defaultOpen={Boolean(params.get("space") || params.get("from") || params.get("to"))}
			>
				<Grid columns={1} gap="lg">
					<PageHeader
						title="时间线"
						meta={
							state.ready
								? `${timeline.groups.reduce((count, group) => count + group.items.length, 0)} 条记忆 · ${
										timeline.groups.length
									} 个分组 · UTC`
								: undefined
						}
						actions={
							<>
								<ViewSwitch
									label="时间线显示方式"
									value={table ? "table" : "stream"}
									options={[
										{ value: "stream", label: "时间轴" },
										{ value: "table", label: "表格" },
									]}
									onChange={(value) => setParams(updateLibraryUrl(params, "view", value))}
								/>
								<ViewSwitch
									label="时间依据"
									value={options.field}
									onChange={(value) => setParams(updateLibraryUrl(params, "field", value))}
									options={[
										{ value: "event_time", label: "事件时间" },
										{ value: "created_at", label: "创建时间" },
									]}
								/>
								<ViewSwitch
									label="时间粒度"
									value={options.zoom}
									onChange={(value) => setParams(updateLibraryUrl(params, "zoom", value))}
									options={[
										{ value: "hour", label: "小时" },
										{ value: "day", label: "天" },
										{ value: "month", label: "月" },
									]}
								/>
								<CollapsibleTrigger asChild>
									<Button variant="outline">
										<SlidersHorizontal size={16} aria-hidden="true" />
										筛选
									</Button>
								</CollapsibleTrigger>
								<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
									<RefreshCw size={16} aria-hidden="true" />
									刷新
								</Button>
							</>
						}
					/>
					<CollapsibleContent unstyled>
						<FilterBar
							label="时间线范围筛选"
							active={Boolean(params.get("space") || params.get("from") || params.get("to"))}
							clearLabel="清除范围筛选"
							onClear={() => {
								const next = new URLSearchParams(params);
								for (const key of ["space", "from", "to"]) next.delete(key);
								setParams(next);
							}}
							chips={(
								[
									["space", "空间"],
									["from", "开始时间"],
									["to", "结束时间"],
								] as const
							).map(([key, label]) =>
								params.get(key) ? (
									<FilterChip
										key={key}
										label={label}
										value={params.get(key)}
										removeLabel={`移除${label}筛选`}
										onRemove={() => setParams(updateLibraryUrl(params, key, ""))}
									/>
								) : null,
							)}
						>
							<SpaceFilter
								memories={state.memories}
								value={params.get("space") ?? ""}
								onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
							/>
							{rangeField("from", "开始时间（UTC）")}
							{rangeField("to", "结束时间（UTC）")}
						</FilterBar>
					</CollapsibleContent>
				</Grid>
			</Collapsible>

			<LibraryStatus state={state} onRetry={() => void model.load()} />
			{state.ready && timeline.undated > 0 && (
				<p className="text-basalt-sm text-basalt-muted-foreground">
					{timeline.undated} 条记忆缺少有效的
					{options.field === "event_time" ? "事件时间" : "创建时间"}，不会使用其他时间替代。
				</p>
			)}
			{state.ready && timeline.groups.length === 0 && (
				<LayerCard>
					<LayerCard.Empty
						className="octo-empty octo-empty--page"
						icon={<CalendarDays aria-hidden="true" />}
						title="没有带有效时间的记忆"
						description="试试其他时间依据、范围或空间。"
						action={
							<Button asChild>
								<Link href="/memories">
									<ArrowUpRight size={16} aria-hidden="true" />
									浏览记忆
								</Link>
							</Button>
						}
					/>
				</LayerCard>
			)}
			{state.ready && timeline.groups.length > 0 && (
				<TimelineRecords
					groups={timeline.groups}
					zoom={options.zoom}
					table={table}
					selected={selectedIds(params)}
					onSelected={(ids) => setParams(setSelection(params, ids))}
				/>
			)}
		</Grid>
	);
}
