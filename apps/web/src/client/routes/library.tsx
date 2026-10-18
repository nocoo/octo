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
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { Text } from "@nocoo/basalt/components/text";
import {
	AlertCircle,
	ArrowDown,
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
	Trash2,
} from "lucide-react";
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
			<Field label="空间">
				<SelectTrigger aria-label="按空间筛选" className="w-basalt-36 max-w-full">
					<SelectValue placeholder="全部空间" />
				</SelectTrigger>
			</Field>
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
			header: "节点",
			width: "24ch",
			accessor: (node) => (node.href ? <Link href={node.href}>{node.label}</Link> : node.label),
			sortValue: (node) => node.label,
			wrap: true,
		},
		{
			id: "kind",
			header: "类型",
			width: "12ch",
			accessor: (node) => (
				<Badge variant="secondary">
					{{ tag: "标签", memory: "记忆", cluster: "聚合节点" }[node.kind]}
				</Badge>
			),
			sortValue: (node) => node.kind,
		},
		{
			id: "count",
			header: "数量",
			width: "10ch",
			accessor: (node) => node.count,
			sortValue: (node) => node.count,
			textAlign: "end",
			cellClassName: "tabular-nums",
		},
	];
	return (
		<Grid columns={1}>
			<DataTable
				aria-label="图谱节点"
				data={graph.nodes}
				columns={columns}
				getRowId={(node) => node.id}
				selected={selected}
				onSelectedChange={onSelected}
				pageSize={20}
				empty={
					<LayerCard.Empty
						icon={<Network aria-hidden="true" />}
						title="没有符合筛选条件的节点。"
						action={
							<Button asChild>
								<Link href="/memories">
									<ArrowUpRight size={16} aria-hidden="true" />
									浏览记忆
								</Link>
							</Button>
						}
					/>
				}
			/>
			<DataTable
				aria-label="图谱关系"
				data={graph.links}
				columns={[
					{
						id: "source",
						header: "起点",
						width: "24ch",
						accessor: (link) => labels.get(link.source),
						sortValue: (link) => labels.get(link.source) ?? link.source,
						wrap: true,
					},
					{
						id: "target",
						header: "终点",
						width: "24ch",
						accessor: (link) => labels.get(link.target),
						sortValue: (link) => labels.get(link.target) ?? link.target,
						wrap: true,
					},
					{
						id: "value",
						header: "关联强度",
						width: "12ch",
						accessor: (link) => link.value,
						sortValue: (link) => link.value,
						textAlign: "end",
					},
				]}
				getRowId={(link) => JSON.stringify([link.source, link.target])}
				pageSize={20}
				empty={
					<LayerCard.Empty
						icon={<Network aria-hidden="true" />}
						title="当前样本中没有关联。"
						action={
							<Button asChild>
								<Link href="/memories">
									<ArrowUpRight size={16} aria-hidden="true" />
									浏览记忆
								</Link>
							</Button>
						}
					/>
				}
			/>
		</Grid>
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
					{tag.display_name}
				</Link>
			),
			sortValue: (tag) => tag.name,
		},
		{
			id: "count",
			header: "记忆数",
			width: "10ch",
			accessor: (tag) => tag.use_count,
			sortValue: (tag) => tag.use_count,
			textAlign: "end",
			cellClassName: "tabular-nums",
		},
		{
			id: "actions",
			header: "操作",
			width: "24ch",
			sortable: false,
			accessor: (tag) => (
				<Grid columns={2} gap="sm">
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
						<SectionRule title="标签共现" hint="每条连线表示同时包含这两个标签的记忆数。">
							<LayerCard>
								<LayerCard.Header>
									标签之间的联系 <Link href="/graph?mode=cooccurrence">探索图谱</Link>
								</LayerCard.Header>
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
	const opener = useRef<HTMLButtonElement | null>(null);
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
			accessor: (space) => (
				<Link href={`/memories?${new URLSearchParams({ spaces: space.slug })}`}>{space.name}</Link>
			),
			sortValue: (space) => space.name,
		},
		{ id: "slug", header: "标识", width: "36ch", accessor: (space) => space.slug },
		{
			id: "description",
			header: "说明",
			width: "32ch",
			accessor: (space) => space.description,
			wrap: true,
		},
		{
			id: "owner",
			header: "所属密钥",
			width: "24ch",
			accessor: (space) =>
				space.owner_key_id ? (
					<Link href="/keys">
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
			accessor: (space) => space.memory_count,
			sortValue: (space) => space.memory_count,
			textAlign: "end",
			cellClassName: "tabular-nums",
		},
	];
	return (
		<Grid columns={1} gap="lg">
			<PageHeader
				title="空间"
				actions={
					<>
						<Input
							className="w-basalt-40 max-w-full"
							aria-label="筛选空间"
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
			<LibraryStatus state={state} onRetry={() => void model.load()} hideError={creating} />
			{state.ready && (
				<LayerCard padding="none">
					<DataTable
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

export function TrashPage() {
	const { model, state } = useLibrary("trash");
	const [params, setParams] = useSearchParams();
	const [title, setTitle] = useState("");
	const [purgeError, setPurgeError] = useState<string | null>(null);
	const region = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLButtonElement | null>(null);
	const restoreFocus = (event: Event) => {
		event.preventDefault();
		(opener.current?.isConnected ? opener.current : region.current)?.focus();
	};
	const selected = selectedIds(params);
	const visible = filterMemories(state.memories, params);
	const columns: DataTableColumn<LibraryMemory>[] = [
		{ id: "title", header: "记忆", width: "24ch", accessor: (item) => item.title, wrap: true },
		{ id: "space", header: "空间", width: "24ch", accessor: (item) => item.space },
		{
			id: "deleted",
			header: "移入时间",
			width: "24ch",
			accessor: (item) =>
				item.deleted_at ? new Date(item.deleted_at).toLocaleString("zh-CN") : "未知",
			sortValue: (item) => item.deleted_at ?? "",
		},
		{
			id: "purge",
			header: "永久删除",
			width: "16ch",
			sortable: false,
			accessor: (item) => (
				<Button
					size="sm"
					variant="destructive"
					disabled={state.busy}
					aria-label={`永久删除 ${item.title}`}
					onClick={(event) => {
						opener.current = event.currentTarget;
						setTitle("");
						setPurgeError(null);
						model.beginPurge(item.id);
					}}
				>
					<Trash2 size={16} aria-hidden="true" />
					永久删除
				</Button>
			),
		},
	];
	return (
		<Grid columns={1} gap="lg" {...{ ref: region }} tabIndex={-1}>
			<PageHeader
				title="回收站"
				description="回收站不会自动清空。可恢复记忆；永久删除需要两次确认。"
				actions={
					<>
						<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
							<RefreshCw size={16} aria-hidden="true" />
							刷新
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
							<RotateCcw size={16} aria-hidden="true" />
							恢复所选记忆（{selected.length}）
						</Button>
					</>
				}
				filters={
					<Grid
						columns={1}
						style={{
							display: "flex",
							flexWrap: "wrap",
							alignItems: "end",
							gap: "var(--basalt-space-layout-sm)",
						}}
					>
						<Field label="查找记忆">
							<Input
								className="w-basalt-56 max-w-full"
								aria-label="筛选回收站"
								placeholder="查找已删除的记忆"
								value={params.get("q") ?? ""}
								onChange={(event) => setParams(updateLibraryUrl(params, "q", event.target.value))}
							/>
						</Field>
						<SpaceFilter
							memories={state.memories}
							value={params.get("space") ?? ""}
							onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
						/>
					</Grid>
				}
			/>
			<LibraryStatus
				state={state}
				onRetry={() => void (state.nextCursor && state.ready ? model.loadMore() : model.load())}
				hideError={state.purge?.stage === "confirm"}
			/>
			{state.failures.map((failure) => (
				<p key={failure.id} role="alert">
					{failure.id}: {failure.message}
				</p>
			))}
			{state.ready && (
				<LayerCard>
					<DataTable
						aria-label="回收站中的记忆"
						data={visible}
						columns={columns}
						selected={selected}
						onSelectedChange={(ids) => setParams(setSelection(params, ids))}
						multiple
						getRowId={(item) => item.id}
						pageSize={25}
						edge="attached"
						loading={state.busy && !state.ready}
						empty={
							<LayerCard.Empty
								icon={<Trash2 aria-hidden="true" />}
								title={
									state.nextCursor
										? "已加载的记忆中没有符合条件的内容"
										: "当前筛选条件下，回收站为空。"
								}
								action={
									state.nextCursor ? (
										<Button loading={state.busy} onClick={() => void model.loadMore()}>
											<ArrowDown size={16} aria-hidden="true" />
											加载更多
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
					<LayerCard.Footer>
						<Grid
							gap="sm"
							className="w-full"
							style={{
								gridTemplateColumns:
									"repeat(auto-fit, minmax(min(100%, var(--basalt-space-56)), 1fr))",
								alignItems: "end",
							}}
						>
							<p className="text-basalt-sm text-basalt-muted-foreground" role="status">
								已加载 {state.memories.length} 条记忆，筛选仅作用于已加载的内容。
							</p>
							{state.nextCursor && visible.length > 0 && (
								<Button
									variant="outline"
									loading={state.busy}
									onClick={() => void model.loadMore()}
								>
									<ArrowDown size={16} aria-hidden="true" />
									加载更多
								</Button>
							)}
						</Grid>
					</LayerCard.Footer>
				</LayerCard>
			)}
			<Dialog
				open={state.purge?.stage === "title"}
				onOpenChange={(open) => {
					if (!open) model.cancelPurge();
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!model.state.purge) restoreFocus(event);
					}}
				>
					<DialogHeader>
						<DialogTitle>输入记忆标题</DialogTitle>
						<DialogDescription>
							永久删除会移除这条记忆、所有版本及附件。请输入完整标题：{" "}
							<strong>{state.purge?.title}</strong>
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							model.confirmPurgeTitle(title);
						}}
					>
						<Grid columns={1}>
							<Field label="确认标题" htmlFor="purge-title" required>
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
									取消
								</Button>
								<Button type="submit" variant="destructive" disabled={title !== state.purge?.title}>
									继续
								</Button>
							</DialogFooter>
						</Grid>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				cancelLabel="取消"
				open={state.purge?.stage === "confirm"}
				onOpenChange={(open) => {
					if (!open) model.cancelPurge();
				}}
				onCloseAutoFocus={restoreFocus}
				title="确认永久删除？"
				description={
					<>
						最后确认：删除后将无法恢复「{state.purge?.title}」。
						{purgeError && (
							<Text as="span" role="alert" className="mt-basalt-space-sm block text-basalt-danger">
								永久删除失败：{purgeError}
							</Text>
						)}
					</>
				}
				confirmLabel="永久删除"
				variant="destructive"
				loading={state.busy}
				onConfirm={async () => {
					const id = state.purge?.id;
					setPurgeError(null);
					if (await model.purge())
						setParams(
							setSelection(
								params,
								selected.filter((item) => item !== id),
							),
						);
					else setPurgeError(model.state.error ?? "请求失败，请稍后重试。");
				}}
			/>
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
	return (
		<Grid columns={1} gap="lg">
			<PageHeader
				title="关系图"
				actions={
					<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
						<RefreshCw size={16} aria-hidden="true" />
						刷新
					</Button>
				}
				filters={
					<Grid
						columns={1}
						style={{
							display: "flex",
							flexWrap: "wrap",
							alignItems: "end",
							gap: "var(--basalt-space-layout-sm)",
						}}
					>
						<SegmentControl
							legend="关系类型"
							value={options.mode}
							onValueChange={(value) => setParams(updateLibraryUrl(params, "mode", value))}
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
						<Field className="w-basalt-28" label="节点上限" htmlFor="graph-cap">
							<Input
								id="graph-cap"
								type="number"
								min={10}
								max={500}
								value={options.cap}
								onChange={(event) => setParams(updateLibraryUrl(params, "cap", event.target.value))}
							/>
						</Field>
					</Grid>
				}
			/>
			<LibraryStatus state={state} onRetry={() => void model.load()} />
			{state.ready && graph.nodes.length === 0 && (
				<LayerCard>
					<LayerCard.Empty
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
			{state.ready && graph.nodes.length > 0 && (
				<>
					<LayerCard>
						<LayerCard.Header>
							<span>
								{graph.nodes.length} 个节点 · {graph.links.length} 条关联
							</span>
							{graph.clustered > 0 && (
								<Badge variant="secondary">已聚合 {graph.clustered} 个节点</Badge>
							)}
						</LayerCard.Header>
						<LayerCard.Body>
							<Grid columns={1}>
								<Suspense fallback={<p role="status">正在加载图谱…</p>}>
									<GraphCanvas graph={graph} />
								</Suspense>
							</Grid>
						</LayerCard.Body>
					</LayerCard>
					<SectionRule title="图谱数据表" hint="可在表格或图谱中选择节点，所选节点会保存在网址中。">
						<LayerCard>
							<LayerCard.Body>
								<Grid columns={1}>
									<GraphTables
										graph={graph}
										selected={params.get("node") ? [params.get("node") as string] : []}
										onSelected={(ids) => setParams(updateLibraryUrl(params, "node", ids[0] ?? ""))}
									/>
								</Grid>
							</LayerCard.Body>
						</LayerCard>
					</SectionRule>
				</>
			)}
		</Grid>
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
			header: "时间（UTC）",
			width: "28ch",
			accessor: (item) => new Date(item.timestamp).toISOString(),
			sortValue: (item) => item.timestamp,
		},
		{
			id: "memory",
			header: "记忆",
			width: "24ch",
			accessor: (item) => (
				<Link href={`/memories/${encodeURIComponent(item.id)}`}>{item.title}</Link>
			),
			sortValue: (item) => item.title,
			wrap: true,
		},
		{ id: "space", header: "空间", width: "24ch", accessor: (item) => item.space },
	];
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
				<Grid columns={1} gap="sm">
					<PageHeader
						title="时间线"
						actions={
							<Button variant="outline" disabled={state.busy} onClick={() => void model.load()}>
								<RefreshCw size={16} aria-hidden="true" />
								刷新
							</Button>
						}
						filters={
							<Grid
								columns={1}
								style={{
									display: "flex",
									flexWrap: "wrap",
									alignItems: "end",
									gap: "var(--basalt-space-layout-sm)",
								}}
							>
								<SegmentControl
									legend="时间依据"
									value={options.field}
									onValueChange={(value) => setParams(updateLibraryUrl(params, "field", value))}
									options={[
										{ value: "event_time", label: "事件时间" },
										{ value: "created_at", label: "创建时间" },
									]}
								/>
								<SegmentControl
									legend="时间粒度"
									value={options.zoom}
									onValueChange={(value) => setParams(updateLibraryUrl(params, "zoom", value))}
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
							</Grid>
						}
					/>
					<CollapsibleContent unstyled>
						<Grid
							gap="sm"
							style={{
								gridTemplateColumns:
									"repeat(auto-fit, minmax(min(100%, var(--basalt-space-56)), 1fr))",
								alignItems: "start",
							}}
						>
							<SpaceFilter
								memories={state.memories}
								value={params.get("space") ?? ""}
								onChange={(value) => setParams(updateLibraryUrl(params, "space", value))}
							/>
							{rangeField("from", "开始时间（UTC）")}
							{rangeField("to", "结束时间（UTC）")}
						</Grid>
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
			{state.ready &&
				timeline.groups.map((group) => (
					<LayerCard key={group.label}>
						<LayerCard.Header>
							{group.label} <Badge variant="secondary">{group.items.length} 条记忆</Badge>
						</LayerCard.Header>
						<LayerCard.Body>
							<Grid columns={1}>
								<Timeline
									ariaLabel={`${group.label} 的记忆`}
									items={group.items.map((item) => {
										const timestamp = new Date(item.timestamp).toISOString();
										return {
											id: item.id,
											title: item.title,
											at:
												options.zoom === "month"
													? `${timestamp.slice(5, 10)} ${timestamp.slice(11, 16)} UTC`
													: `${timestamp.slice(11, 16)} UTC`,
										};
									})}
								/>
								<DataTable
									aria-label={`${group.label} 的时间线数据`}
									data={group.items}
									columns={columns}
									getRowId={(item) => item.id}
									selected={selectedIds(params)}
									onSelectedChange={(ids) => setParams(setSelection(params, ids))}
									pageSize={20}
								/>
							</Grid>
						</LayerCard.Body>
					</LayerCard>
				))}
		</Grid>
	);
}
