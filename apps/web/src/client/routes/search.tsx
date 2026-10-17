import { Badge, Button, Field, Input, LayerCard, Meter } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { CircleAlert, FilterX, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
import { memoryTypeLabels } from "../viewmodels/memories";
import { SearchModel, scoreBars, snippetParts } from "../viewmodels/search";
import { Choice, MemoryFilters } from "./memories-filters";
import { MemoryLink } from "./memories-navigation";
import "./search.css";

export function SearchPage() {
	const [params, setParams] = useSearchParams();
	const location = useLocation();
	const focusIntent = location.state as { focusSearch?: boolean } | null;
	const queryInput = useRef<HTMLInputElement>(null);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const model = useMemo(() => new SearchModel(), []);
	const state = useModel(model);
	const query = params.toString();
	useLayoutEffect(() => {
		if (focusIntent?.focusSearch === true) queryInput.current?.focus();
	}, [focusIntent]);
	useEffect(() => {
		void model.load(new URLSearchParams(query));
	}, [model, query]);
	const result = state.result;
	const maximum = Math.max(0, ...(result?.items.map((item) => item.scores.fused) ?? []));
	return (
		<Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} asChild>
			<Grid columns={1}>
				<PageHeader
					title="搜索"
					actions={
						<>
							<Grid
								columns={1}
								gap="sm"
								className="octo-search-query"
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
							<CollapsibleTrigger asChild>
								<Button type="button" variant="outline" aria-label="高级融合选项">
									<SlidersHorizontal aria-hidden="true" />
									融合选项
								</Button>
							</CollapsibleTrigger>
							<MemoryFilters params={params} onChange={setParams} />
						</>
					}
				/>
				<form
					key={query}
					id="search-options"
					hidden={!advancedOpen}
					aria-label="搜索选项"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const next = new URLSearchParams(params);
						for (const key of ["q", "mode", "fusion", "k", "fts_weight", "vector_weight", "limit"])
							next.set(key, String(form.get(key) ?? ""));
						setParams(next);
					}}
				>
					<CollapsibleContent
						unstyled
						forceMount
						hidden={!advancedOpen}
						data-search-advanced="true"
					>
						<Grid
							columns={1}
							style={{
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
								alignItems: "end",
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
							<Field label="RRF 参数 k" htmlFor="search-k">
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
							<Field label="全文权重" htmlFor="search-fts-weight">
								<Input
									id="search-fts-weight"
									name="fts_weight"
									type="number"
									min={0}
									step={0.1}
									defaultValue={params.get("fts_weight") ?? "1"}
								/>
							</Field>
							<Field label="向量权重" htmlFor="search-vector-weight">
								<Input
									id="search-vector-weight"
									name="vector_weight"
									type="number"
									min={0}
									step={0.1}
									defaultValue={params.get("vector_weight") ?? "1"}
								/>
							</Field>
							<Field label="结果条数" htmlFor="search-limit">
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
					</CollapsibleContent>
				</form>
				{state.error && (
					<Banner
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
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
								alignItems: "center",
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
									icon={<Search aria-hidden="true" />}
									title="没有匹配结果"
									action={
										<Button
											onClick={() => {
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
						{result.items.map((item) => {
							const bars = scoreBars(item.scores, maximum);
							return (
								<LayerCard key={item.id}>
									<LayerCard.Header>
										<MemoryLink memoryId={item.id} memoryTitle={item.title}>
											<strong>{item.title}</strong>
										</MemoryLink>
									</LayerCard.Header>
									<LayerCard.Body style={{ display: "grid", gap: "var(--basalt-space-layout)" }}>
										{item.snippet !== undefined && (
											<p>
												{snippetParts(item.snippet).map((part) =>
													part.marked ? <mark key={part.offset}>{part.text}</mark> : part.text,
												)}
											</p>
										)}
										<Grid
											columns={1}
											gap="sm"
											style={{
												gridTemplateColumns:
													"repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
												alignItems: "center",
												overflowWrap: "anywhere",
											}}
										>
											<Badge variant="outline">{item.space}</Badge>
											<Badge variant="secondary">{memoryTypeLabels[item.type] ?? "未知类型"}</Badge>
											{item.tags.map((tag) => (
												<Badge key={tag} variant="outline">
													{tag}
												</Badge>
											))}
											<time dateTime={item.updated_at} className="octo-muted">
												{new Date(item.updated_at).toLocaleString("zh-CN")}
											</time>
										</Grid>
										<Grid
											columns={1}
											style={{
												gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
											}}
										>
											<Meter
												label="综合得分"
												value={bars.fused}
												customValue={item.scores.fused.toPrecision(4)}
											/>
											{item.scores.fts && bars.fts !== null ? (
												<Grid columns={1}>
													<Meter
														label="全文"
														value={bars.fts}
														customValue={`第 ${item.scores.fts.rank} 名`}
													/>
													<span className="octo-muted">
														BM25 {item.scores.fts.bm25.toPrecision(4)}
													</span>
												</Grid>
											) : (
												<span className="octo-muted">全文：无匹配</span>
											)}
											{item.scores.vector && bars.vector !== null ? (
												<Grid columns={1}>
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
									</LayerCard.Body>
								</LayerCard>
							);
						})}
					</>
				)}
			</Grid>
		</Collapsible>
	);
}
