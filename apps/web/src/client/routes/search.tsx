import { Badge, Button, Field, Input, LayerCard, Meter } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import { CircleAlert, FilterX, Pencil, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
import { memoryTypeLabels } from "../viewmodels/memories";
import {
	type SearchItem,
	SearchModel,
	type SearchOptionField,
	scoreBars,
	searchOptionErrors,
	snippetParts,
} from "../viewmodels/search";
import { Choice, MemoryFilters } from "./memories-filters";
import { MemoryLink } from "./memories-navigation";

export function SearchPage() {
	const [params, setParams] = useSearchParams();
	const location = useLocation();
	const focusIntent = location.state as { focusSearch?: boolean } | null;
	const queryInput = useRef<HTMLInputElement>(null);
	const [advancedOpen, setAdvancedOpen] = useState(
		["mode", "fusion", "k", "fts_weight", "vector_weight", "limit"].some((key) => params.has(key)),
	);
	const optionsForm = useRef<HTMLFormElement>(null);
	const [fieldErrors, setFieldErrors] = useState<Partial<Record<SearchOptionField, string>>>({});
	useLayoutEffect(() => {
		if (!advancedOpen) return;
		const first = Object.keys(fieldErrors)[0];
		const field = first && optionsForm.current?.elements.namedItem(first);
		if (field instanceof HTMLInputElement) field.focus();
	}, [advancedOpen, fieldErrors]);
	const model = useMemo(() => new SearchModel(), []);
	const state = useModel(model);
	const query = params.toString();
	const previousQuery = useRef(query);
	useLayoutEffect(() => {
		if (previousQuery.current !== query) {
			previousQuery.current = query;
			setFieldErrors({});
		}
	}, [query]);
	useLayoutEffect(() => {
		if (focusIntent?.focusSearch === true) queryInput.current?.focus();
	}, [focusIntent]);
	useEffect(() => {
		void model.load(new URLSearchParams(query));
	}, [model, query]);
	const result = state.result;
	const maximum = Math.max(0, ...(result?.items.map((item) => item.scores.fused) ?? []));
	const columns: DataTableColumn<SearchItem>[] = [
		{
			id: "title",
			header: "记忆 / 摘要",
			width: "36ch",
			wrap: true,
			sortable: false,
			accessor: (item) => (
				<Grid columns={1} style={{ gap: "var(--basalt-space-control-gap)" }}>
					<MemoryLink memoryId={item.id} memoryTitle={item.title}>
						<strong>{item.title}</strong>
					</MemoryLink>
					{item.snippet !== undefined && (
						<p className="text-basalt-muted-foreground">
							{snippetParts(item.snippet).map((part) =>
								part.marked ? <mark key={part.offset}>{part.text}</mark> : part.text,
							)}
						</p>
					)}
				</Grid>
			),
		},
		{
			id: "metadata",
			header: "空间 / 标签",
			width: "24ch",
			wrap: true,
			sortable: false,
			accessor: (item) => (
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
					<TagBadge name={item.space} size="sm" />
					<Badge variant="secondary">{memoryTypeLabels[item.type] ?? "未知类型"}</Badge>
					{item.tags.map((tag) => (
						<TagBadge key={tag} name={tag} size="sm" />
					))}
				</Grid>
			),
		},
		{
			id: "score",
			header: "综合得分",
			width: "20ch",
			wrap: true,
			textAlign: "end",
			sortable: false,
			accessor: (item) => {
				const bars = scoreBars(item.scores, maximum);
				return (
					<Grid columns={1} style={{ gap: "var(--basalt-space-control-gap)" }}>
						<span className="font-medium tabular-nums">{item.scores.fused.toPrecision(4)}</span>
						<Collapsible>
							<CollapsibleTrigger>得分详情</CollapsibleTrigger>
							<CollapsibleContent unstyled>
								<Grid columns={1} gap="sm" className="text-start">
									<Meter
										label="综合得分"
										value={bars.fused}
										customValue={item.scores.fused.toPrecision(4)}
									/>
									{item.scores.fts && bars.fts !== null ? (
										<Grid columns={1} gap="sm">
											<Meter
												label="全文"
												value={bars.fts}
												customValue={`第 ${item.scores.fts.rank} 名`}
											/>
											<span className="octo-muted">BM25 {item.scores.fts.bm25.toPrecision(4)}</span>
										</Grid>
									) : (
										<span className="octo-muted">全文：无匹配</span>
									)}
									{item.scores.vector && bars.vector !== null ? (
										<Grid columns={1} gap="sm">
											<Meter
												label="向量"
												value={bars.vector}
												customValue={`第 ${item.scores.vector.rank} 名`}
											/>
											<span className="octo-muted">
												余弦相似度 {item.scores.vector.similarity.toPrecision(4)}
											</span>
										</Grid>
									) : (
										<span className="octo-muted">向量：无匹配</span>
									)}
								</Grid>
							</CollapsibleContent>
						</Collapsible>
					</Grid>
				);
			},
		},
		{
			id: "updated",
			header: "更新时间",
			width: "24ch",
			textAlign: "end",
			sortable: false,
			accessor: (item) => (
				<time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString("zh-CN")}</time>
			),
		},
		{
			id: "actions",
			header: "操作",
			width: "12ch",
			textAlign: "end",
			sortable: false,
			accessor: (item) => (
				<Button asChild size="sm" variant="ghost">
					<Link
						to={`/memories/${encodeURIComponent(item.id)}/edit`}
						aria-label={`编辑 ${item.title}`}
					>
						<Pencil aria-hidden="true" />
						编辑
					</Link>
				</Button>
			),
		},
	];
	return (
		<Grid columns={1}>
			<MemoryFilters params={params} onChange={setParams}>
				{(filterTrigger) => (
					<PageHeader
						title={
							<span className="octo-page-title">
								<Search className="octo-title-icon" aria-hidden="true" />
								搜索
							</span>
						}
						actions={
							<>
								{filterTrigger}
								<Button
									type="button"
									variant="outline"
									aria-label="高级融合选项"
									aria-expanded={advancedOpen}
									aria-controls="search-options"
									onClick={() => setAdvancedOpen((open) => !open)}
								>
									<SlidersHorizontal aria-hidden="true" />
									融合选项
								</Button>
							</>
						}
						filters={
							<Grid
								columns={1}
								gap="sm"
								className="w-full"
								style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}
							>
								<Input
									ref={queryInput}
									key={query}
									id="search-query"
									name="q"
									form="search-options"
									aria-label="搜索记忆"
									data-search-input
									defaultValue={params.get("q") ?? ""}
									placeholder="输入关键词"
									required
								/>
								<Button type="submit" form="search-options" loading={state.loading}>
									<Search aria-hidden="true" />
									搜索
								</Button>
							</Grid>
						}
					/>
				)}
			</MemoryFilters>
			<form
				ref={optionsForm}
				key={query}
				id="search-options"
				hidden={!advancedOpen}
				noValidate
				aria-label="搜索选项"
				data-search-advanced="true"
				onSubmit={(event) => {
					event.preventDefault();
					if (!queryInput.current?.reportValidity()) return;
					const form = new FormData(event.currentTarget);
					const next = new URLSearchParams(params);
					for (const key of ["q", "mode", "fusion", "k", "fts_weight", "vector_weight", "limit"])
						next.set(key, String(form.get(key) ?? ""));
					const errors = searchOptionErrors(next);
					setFieldErrors(errors);
					if (Object.keys(errors).length) {
						setAdvancedOpen(true);
						return;
					}
					setParams(next);
				}}
			>
				<Grid
					columns={1}
					style={{
						gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
						alignItems: "start",
					}}
				>
					<Choice
						label="搜索模式"
						name="mode"
						value={params.get("mode") ?? "hybrid"}
						options={["hybrid", "fts", "vector"]}
					/>
					<Choice
						label="融合方式"
						name="fusion"
						value={params.get("fusion") ?? "rrf"}
						options={["rrf", "weighted"]}
					/>
					<Field label="RRF 参数 k" htmlFor="search-k" error={fieldErrors.k ?? null}>
						<Input
							id="search-k"
							name="k"
							type="number"
							min={1}
							max={200}
							step={1}
							defaultValue={params.get("k") ?? "60"}
						/>
					</Field>
					<Field
						label="全文权重"
						htmlFor="search-fts-weight"
						error={fieldErrors.fts_weight ?? null}
					>
						<Input
							id="search-fts-weight"
							name="fts_weight"
							type="number"
							min={0}
							step={0.1}
							defaultValue={params.get("fts_weight") ?? "1"}
						/>
					</Field>
					<Field
						label="向量权重"
						htmlFor="search-vector-weight"
						error={fieldErrors.vector_weight ?? null}
					>
						<Input
							id="search-vector-weight"
							name="vector_weight"
							type="number"
							min={0}
							step={0.1}
							defaultValue={params.get("vector_weight") ?? "1"}
						/>
					</Field>
					<Field label="结果条数" htmlFor="search-limit" error={fieldErrors.limit ?? null}>
						<Input
							id="search-limit"
							name="limit"
							type="number"
							min={1}
							max={200}
							step={1}
							defaultValue={params.get("limit") ?? "50"}
						/>
					</Field>
				</Grid>
			</form>
			{state.error && (
				<Banner
					role="alert"
					variant="error"
					icon={<CircleAlert aria-hidden="true" />}
					title="搜索失败"
					description={state.error}
					action={
						<Banner.Action onClick={() => void model.load(params)}>
							<RotateCcw aria-hidden="true" />
							重试
						</Banner.Action>
					}
				/>
			)}
			{state.fallback && (
				<Banner
					variant="alert"
					icon={<CircleAlert aria-hidden="true" />}
					title="语义搜索暂不可用"
					description={
						<>
							已按当前筛选条件显示全文搜索结果。{" "}
							<Link to="/settings/embedding">配置或测试嵌入网关</Link>。
						</>
					}
				/>
			)}
			{result?.channels.fts.partial && (
				<Banner
					variant="alert"
					icon={<CircleAlert aria-hidden="true" />}
					title="全文搜索结果不完整"
					description="短查询扫描已达到候选数量上限。缩小筛选范围可获得更精确的结果。"
				/>
			)}
			{result?.channels.vector.truncated && (
				<Banner
					variant="alert"
					icon={<CircleAlert aria-hidden="true" />}
					title="向量候选结果已截断"
					description="后置筛选移除了部分向量候选结果。请缩小查询或筛选范围，减少遗漏。"
				/>
			)}
			{state.loading && <p role="status">正在搜索…</p>}
			{!params.get("q") && (
				<LayerCard>
					<LayerCard.Empty
						className="octo-empty octo-empty--page"
						icon={<Search aria-hidden="true" />}
						title="搜索你的知识库"
						action={
							<Button onClick={() => queryInput.current?.focus()}>
								<Search aria-hidden="true" />
								开始搜索
							</Button>
						}
						description="输入关键词。混合搜索会同时匹配全文和语义。"
					/>
				</LayerCard>
			)}
			{result && (
				<>
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
						role="status"
					>
						<span>{result.items.length} 条结果</span>
						<Badge variant="outline">全文候选： {result.channels.fts.candidates}</Badge>
						<Badge variant="outline">
							向量候选： {result.channels.vector.candidates ?? "已跳过"}
						</Badge>
						{result.channels.vector.profile && (
							<Badge variant="secondary">{result.channels.vector.profile}</Badge>
						)}
					</Grid>
					{!result.items.length && !state.loading && !state.error && (
						<LayerCard>
							<LayerCard.Empty
								className="octo-empty octo-empty--page"
								icon={<Search aria-hidden="true" />}
								title="没有匹配结果"
								action={
									<Button
										onClick={() => {
											setFieldErrors({});
											setParams(new URLSearchParams());
											queryInput.current?.focus();
										}}
									>
										<FilterX aria-hidden="true" />
										重新搜索
									</Button>
								}
								description="试试其他关键词，或放宽筛选条件。"
							/>
						</LayerCard>
					)}
					{result.items.length > 0 && (
						<LayerCard padding="none">
							<DataTable
								className="octo-table"
								aria-label="搜索结果"
								data={result.items}
								columns={columns}
								getRowId={(item) => item.id}
								manualSorting
								manualFiltering
								manualPagination
								edge="attached"
							/>
						</LayerCard>
					)}
				</>
			)}
		</Grid>
	);
}
