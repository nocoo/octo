import {
	Button,
	Checkbox,
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
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
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
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	Check,
	ListChecks,
	RefreshCw,
	RotateCcw,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
import { type LibraryMemory, setSelection } from "../viewmodels/library";
import {
	readTrashFilters,
	readTrashSelection,
	selectAllTrash,
	setTrashFilter,
	setTrashPageSelection,
	TrashModel,
	trashScope,
} from "../viewmodels/trash";

export function TrashPage() {
	const [model] = useState(() => new TrashModel());
	const state = useModel(model);
	const [params, setParams] = useSearchParams();
	const [title, setTitle] = useState("");
	const region = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLButtonElement | null>(null);
	const mounted = useRef(true);
	const filters = readTrashFilters(params);
	const filterKey = JSON.stringify(filters);
	const selection = readTrashSelection(params);
	const selectionKey = JSON.stringify(selection);
	const locked = state.busy || state.preparing || state.loading;
	const selectedCount = selection.all
		? Math.max(0, state.total - selection.excluded.length)
		: selection.ids.length;
	const checked = (id: string) =>
		selection.all ? !selection.excluded.includes(id) : selection.ids.includes(id);
	const pageIds = state.memories.map((item) => item.id);
	const selectedOnPage = pageIds.filter(checked).length;
	const confirmation = state.confirmation;

	useEffect(() => {
		mounted.current = true;
		void model.loadSpaces();
		return () => {
			mounted.current = false;
			model.dispose();
		};
	}, [model]);
	useEffect(() => {
		if (!state.busy && (!model.state.ready || JSON.stringify(model.state.filters) !== filterKey))
			void model.load(JSON.parse(filterKey));
	}, [model, filterKey, state.busy]);
	useEffect(() => {
		model.selectionChanged(selectionKey);
	}, [model, selectionKey]);
	useEffect(() => {
		if (state.notice) {
			if (model.state.error || model.state.failures.length) toast.error(state.notice);
			else toast.success(state.notice);
		}
	}, [model, state.notice]);

	const restoreFocus = (event: Event) => {
		event.preventDefault();
		(opener.current?.isConnected ? opener.current : region.current)?.focus();
	};
	async function finish(action: () => Promise<boolean>, selectedBatch = false) {
		const original = params.toString();
		const empty = model.state.confirmation?.kind === "empty";
		const completed = await action();
		if (!mounted.current) return;
		const resolved = completed && (selectedBatch || (empty && !model.state.failures.length));
		const remaining = selection.all
			? model.state.failures.map((failure) => failure.id)
			: selection.ids.filter((id) => !model.state.succeeded.includes(id));
		setParams(
			(current) => {
				if (current.toString() !== original) return current;
				if (selection.all && !resolved) {
					const next = new URLSearchParams(current);
					for (const id of model.state.succeeded) next.delete("excluded", id);
					return next;
				}
				const next = setSelection(current, remaining);
				next.delete("all");
				next.delete("excluded");
				return next;
			},
			{ replace: true },
		);
	}
	function clearSelection() {
		const next = setSelection(params, []);
		next.delete("all");
		next.delete("excluded");
		setParams(next);
	}
	const columns: DataTableColumn<LibraryMemory>[] = [
		{
			id: "selection",
			header: "全选当前页",
			width: "8ch",
			sortable: false,
			headerContent: (
				<Checkbox
					aria-label="全选当前页"
					checked={
						pageIds.length > 0 && selectedOnPage === pageIds.length
							? true
							: selectedOnPage > 0
								? "indeterminate"
								: false
					}
					disabled={locked || pageIds.length === 0}
					onCheckedChange={(value) =>
						setParams(setTrashPageSelection(params, pageIds, value === true))
					}
				/>
			),
			accessor: (item) => (
				<Checkbox
					aria-label={`选择 ${item.title}`}
					checked={checked(item.id)}
					disabled={locked}
					onCheckedChange={(value) =>
						setParams(setTrashPageSelection(params, [item.id], value === true))
					}
				/>
			),
		},
		{
			id: "title",
			header: "记忆",
			width: "24ch",
			accessor: (item) => item.title,
			wrap: true,
			sortable: false,
		},
		{ id: "space", header: "空间", width: "24ch", accessor: (item) => item.space, sortable: false },
		{
			id: "deleted",
			header: "移入时间",
			width: "24ch",
			accessor: (item) =>
				item.deleted_at ? new Date(item.deleted_at).toLocaleString("zh-CN") : "未知",
			sortable: false,
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
					disabled={locked}
					aria-label={`永久删除 ${item.title}`}
					onClick={(event) => {
						opener.current = event.currentTarget;
						setTitle("");
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
		<Grid columns={1} gap="sm" {...{ ref: region }} tabIndex={-1}>
			<PageHeader
				title="回收站"
				description="不会自动清空。表头仅选择当前页，全部匹配项需单独选择。"
				actions={
					<>
						<Button variant="outline" disabled={locked} onClick={() => void model.load(filters)}>
							<RefreshCw size={16} aria-hidden="true" />
							刷新
						</Button>
						<Button
							variant="destructive"
							disabled={locked || !state.ready || state.total === 0}
							onClick={(event) => {
								opener.current = event.currentTarget;
								model.prepareEmpty();
							}}
						>
							<Trash2 size={16} aria-hidden="true" />
							清空回收站（{state.total}）
						</Button>
					</>
				}
				filters={
					<Grid
						columns={1}
						gap="sm"
						style={{ display: "flex", flexWrap: "wrap", alignItems: "end" }}
					>
						<Field label="查找记忆" htmlFor="trash-query">
							<Input
								id="trash-query"
								className="w-basalt-56 max-w-full"
								aria-label="筛选回收站"
								placeholder="搜索标题或标签"
								value={params.get("q") ?? ""}
								disabled={state.busy || state.preparing}
								onChange={(event) =>
									setParams(setTrashFilter(params, "q", event.target.value), { replace: true })
								}
							/>
						</Field>
						<Field label="空间">
							<Select
								value={filters.space || "__all__"}
								disabled={state.busy || state.preparing}
								onValueChange={(value) =>
									setParams(setTrashFilter(params, "space", value === "__all__" ? "" : value))
								}
							>
								<SelectTrigger aria-label="按空间筛选" className="w-basalt-36 max-w-full">
									<SelectValue placeholder="全部空间" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__all__">全部空间</SelectItem>
									{filters.space && !state.spaces.some((space) => space.slug === filters.space) && (
										<SelectItem value={filters.space}>{filters.space}</SelectItem>
									)}
									{state.spaces.map((space) => (
										<SelectItem key={space.slug} value={space.slug}>
											{space.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</Grid>
				}
			/>
			{!state.ready && !state.error && <Text role="status">正在加载回收站…</Text>}
			{state.error && confirmation?.kind !== "single" && (
				<Banner
					variant="error"
					size="sm"
					role="alert"
					icon={<AlertCircle size={16} aria-hidden="true" />}
					description={state.error}
					action={
						<Banner.Action disabled={locked} onClick={() => void model.load(filters)}>
							重试
						</Banner.Action>
					}
				/>
			)}
			{state.spacesError && (
				<Banner
					variant="error"
					size="sm"
					role="alert"
					description={`空间列表加载失败：${state.spacesError}`}
					action={
						<Banner.Action onClick={() => void model.loadSpaces()}>重试空间列表</Banner.Action>
					}
				/>
			)}
			{selectedCount > 0 && (
				<Grid columns={1} gap="sm" role="region" aria-label="批量操作回收站">
					<Banner
						size="sm"
						variant="secondary"
						icon={<ListChecks size={16} aria-hidden="true" />}
						description={`已选择 ${selectedCount} 条记忆${selection.all ? "，范围为当前筛选的全部匹配项。" : "。表头只选择当前页。"}`}
						action={
							!selection.all && state.total > selectedCount ? (
								<Banner.Action
									variant="ghost"
									disabled={locked}
									onClick={() => setParams(selectAllTrash(params))}
								>
									选择全部 {state.total} 条
								</Banner.Action>
							) : undefined
						}
					/>
					<Grid
						columns={1}
						gap="sm"
						style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}
					>
						<Button
							disabled={locked || !state.ready}
							onClick={() => void finish(() => model.restore(selection), true)}
						>
							<RotateCcw size={16} aria-hidden="true" />
							恢复所选
						</Button>
						<Button
							variant="destructive"
							disabled={locked || !state.ready}
							onClick={(event) => {
								opener.current = event.currentTarget;
								void model.preparePurge(selection);
							}}
						>
							<Trash2 size={16} aria-hidden="true" />
							彻底删除所选
						</Button>
						<Button variant="ghost" disabled={locked} onClick={clearSelection}>
							<X size={16} aria-hidden="true" />
							取消选择
						</Button>
					</Grid>
				</Grid>
			)}
			{state.preparing && <Text role="status">正在核对全部所选记忆和筛选范围…</Text>}
			{state.busy && state.progress && (
				<Banner
					size="sm"
					role="status"
					description={`已处理 ${state.progress.processed} / ${state.progress.total} 条记忆，请勿关闭页面。`}
				/>
			)}
			{state.notice && (
				<Text role="status" className="text-basalt-sm text-basalt-muted-foreground">
					<Check className="inline" size={16} aria-hidden="true" /> {state.notice}
				</Text>
			)}
			{state.failures.length > 0 && (
				<Banner
					variant="error"
					size="sm"
					role="alert"
					title={`${state.failures.length} 条记忆未完成`}
					description={
						<ul>
							{state.failures.map((failure) => (
								<li key={failure.id}>
									{failure.id}：{failure.message}
								</li>
							))}
						</ul>
					}
				/>
			)}
			{state.ready && (
				<LayerCard>
					<DataTable
						aria-label="回收站中的记忆"
						data={state.memories}
						columns={columns}
						getRowId={(item) => item.id}
						manualFiltering
						manualPagination
						manualSorting
						edge="attached"
						empty={
							<LayerCard.Empty
								icon={<Trash2 aria-hidden="true" />}
								title="当前筛选条件下，回收站为空。"
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
					<LayerCard.Footer>
						<Grid
							columns={1}
							gap="sm"
							className="w-full"
							style={{
								display: "flex",
								flexWrap: "wrap",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<Text className="text-basalt-sm text-basalt-muted-foreground" role="status">
								共 {state.total} 条记忆 · 第 {state.page} 页 · 每页 25 条
							</Text>
							<Grid columns={1} gap="sm" style={{ display: "flex" }}>
								<Button
									size="sm"
									variant="outline"
									disabled={locked || state.page === 1}
									onClick={() => void model.previousPage()}
								>
									<ArrowLeft size={16} aria-hidden="true" />
									上一页
								</Button>
								<Button
									size="sm"
									variant="outline"
									disabled={locked || !state.nextCursor}
									onClick={() => void model.nextPage()}
								>
									下一页
									<ArrowRight size={16} aria-hidden="true" />
								</Button>
							</Grid>
						</Grid>
					</LayerCard.Footer>
				</LayerCard>
			)}
			<Dialog
				open={confirmation?.stage === "title"}
				onOpenChange={(open) => {
					if (!open) model.cancelConfirmation();
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!model.state.confirmation) restoreFocus(event);
					}}
				>
					<DialogHeader>
						<DialogTitle>输入记忆标题</DialogTitle>
						<DialogDescription>
							永久删除会移除这条记忆、所有版本及附件。请输入完整标题：
							<strong>{confirmation?.title}</strong>
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							model.confirmTitle(title);
						}}
					>
						<Grid columns={1}>
							<Field
								label="确认标题"
								htmlFor="purge-title"
								required
								{...(title && title !== confirmation?.title
									? { error: "标题不一致，请输入完整标题。" }
									: {})}
							>
								<Input
									id="purge-title"
									value={title}
									onChange={(event) => setTitle(event.target.value)}
									autoComplete="off"
									required
								/>
							</Field>
							<DialogFooter>
								<Button variant="outline" onClick={() => model.cancelConfirmation()}>
									取消
								</Button>
								<Button
									type="submit"
									variant="destructive"
									disabled={title !== confirmation?.title}
								>
									继续
								</Button>
							</DialogFooter>
						</Grid>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={confirmation?.stage === "confirm"}
				onOpenChange={(open) => {
					if (!open) model.cancelConfirmation();
				}}
				onCloseAutoFocus={restoreFocus}
				title={
					confirmation?.kind === "single"
						? "确认永久删除？"
						: confirmation?.kind === "empty"
							? `清空回收站中的 ${confirmation.count} 条记忆？`
							: `彻底删除所选 ${confirmation?.count ?? 0} 条记忆？`
				}
				description={
					<>
						{confirmation?.kind === "single"
							? `最后确认：删除后将无法恢复「${confirmation.title}」。`
							: `当前筛选范围：${trashScope(confirmation?.filters ?? {})}。将彻底删除 ${confirmation?.count ?? 0} 条记忆、全部版本及附件，删除后无法恢复。`}
						{confirmation?.kind === "single" && state.error && (
							<Text as="span" role="alert" className="mt-basalt-space-sm block text-basalt-danger">
								永久删除失败：{state.error}
							</Text>
						)}
						{state.busy && state.progress && (
							<Text as="span" role="status" className="block">
								已处理 {state.progress.processed} / {state.progress.total} 条记忆
							</Text>
						)}
					</>
				}
				confirmLabel={
					confirmation?.kind === "single"
						? "永久删除"
						: confirmation?.kind === "empty"
							? "确认清空回收站"
							: "确认彻底删除"
				}
				cancelLabel="取消"
				variant="destructive"
				loading={state.busy}
				onConfirm={() => finish(() => model.confirm(), confirmation?.kind === "purge")}
			/>
		</Grid>
	);
}
