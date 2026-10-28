import { Button, LayerCard, StatStrip } from "@nocoo/basalt";
import { Sparkline } from "@nocoo/basalt/charts/sparkline";
import { Banner } from "@nocoo/basalt/components/banner";
import { Grid } from "@nocoo/basalt/components/grid";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nocoo/basalt/components/sheet";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import { Text } from "@nocoo/basalt/components/text";
import { ToggleGroup, ToggleGroupItem } from "@nocoo/basalt/components/toggle-group";
import {
	Activity,
	AlertCircle,
	BookOpen,
	Bot,
	ChartNoAxesCombined,
	RefreshCw,
	TrendingUp,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../components/layout/page-header";
import { useModel } from "../components/layout/use-model";
import { formatNumber, formatPercent } from "../lib/format";
import {
	type BotDetail,
	type BotRow,
	botCalls,
	botDetail,
	botOperations,
	dailySeries,
	OVERVIEW_RANGES,
	OverviewModel,
	operationTotals,
	parseOverviewRange,
	type SpaceDetail,
	type SpaceRow,
	spaceDetail,
	spaceDistribution,
	spaceOperations,
	summary,
	topBots,
	topSpaces,
	typeDistribution,
} from "../viewmodels/overview";
import "./overview.css";
import {
	BotCallChart,
	BotOperationChart,
	OperationTrendChart,
	OverviewDonut,
	opColorOf,
	SpaceTrendChart,
} from "./overview-charts";

function signed(value: number): string {
	return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function botMeta(row: BotRow): string {
	return [
		`${formatNumber(row.ops)} 次操作`,
		`${formatNumber(row.writes)} 次写入`,
		`错误率 ${formatPercent(row.errorRate, 1)}`,
	]
		.filter(Boolean)
		.join(" · ");
}

function BotsPanel({ rows, onSelect }: { rows: BotRow[]; onSelect: (id: string) => void }) {
	if (!rows.length)
		return <p className="text-basalt-sm text-basalt-muted-foreground">所选区间内没有 Bot 活动。</p>;
	return (
		<ol className="octo-rank" aria-label="Bot 排行">
			{rows.map((row) => (
				<li key={row.id} className="octo-rank-entry">
					<Button
						variant="ghost"
						className="octo-rank-row"
						aria-label={`查看 ${row.name} 详情`}
						onClick={() => onSelect(row.id)}
					>
						<span className="octo-rank-main">
							<span className="octo-rank-label" title={row.name}>
								{row.name}
							</span>
							<span className="octo-rank-meta">{botMeta(row)}</span>
						</span>
						<Sparkline
							data={row.sparkline}
							series={[{ key: "value", color: "hsl(var(--basalt-chart-1))" }]}
							ariaLabel={`${row.name} 每日操作量`}
							accessibilityLayer={false}
							summary={<span className="sr-only">{row.name} 每日操作量迷你条形图。</span>}
							className="octo-rank-spark"
						/>
						<span className="octo-rank-value">
							{formatNumber(row.calls)}
							<small>调用</small>
						</span>
					</Button>
				</li>
			))}
		</ol>
	);
}

function SpacesPanel({ rows, onSelect }: { rows: SpaceRow[]; onSelect: (id: string) => void }) {
	if (!rows.length)
		return <p className="text-basalt-sm text-basalt-muted-foreground">还没有空间数据。</p>;
	return (
		<ol className="octo-rank" aria-label="空间排行">
			{rows.map((row) => (
				<li key={row.id} className="octo-rank-entry">
					<Button
						variant="ghost"
						className="octo-rank-row"
						aria-label={`查看 ${row.name} 详情`}
						onClick={() => onSelect(row.id)}
					>
						<span className="octo-rank-main">
							<span className="octo-rank-label" title={row.name}>
								{row.name}
							</span>
							<span className="octo-rank-meta">
								{`${formatNumber(row.memories)} 条记忆`}
								{row.trash ? ` · 回收站 ${formatNumber(row.trash)}` : ""}
								{` · ${formatNumber(row.ops)} 次操作`}
							</span>
						</span>
						<Sparkline
							data={row.sparkline}
							series={[{ key: "value", color: "hsl(var(--basalt-chart-3))" }]}
							ariaLabel={`${row.name} 每日操作量`}
							accessibilityLayer={false}
							summary={<span className="sr-only">{row.name} 每日操作量迷你条形图。</span>}
							className="octo-rank-spark"
						/>
						<span className="octo-rank-value">
							{formatPercent(row.share, 1)}
							<small>记忆占比</small>
						</span>
					</Button>
				</li>
			))}
		</ol>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<Grid
			columns={2}
			className="octo-detail-row"
			style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
		>
			<dt title={label}>{label}</dt>
			<dd>{value}</dd>
		</Grid>
	);
}

function DetailStats({ items }: { items: { label: string; value: string }[] }) {
	return (
		<dl className="octo-detail-stats">
			{items.map((item) => (
				<Grid key={item.label} columns={1} gap="sm">
					<dt className="text-basalt-xs text-basalt-muted-foreground">{item.label}</dt>
					<dd className="text-basalt-md font-medium tabular-nums">{item.value}</dd>
				</Grid>
			))}
		</dl>
	);
}

function BotSheet({ detail, onClose }: { detail: BotDetail; onClose: () => void }) {
	const bot = detail.bot;
	return (
		<Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent side="right" className="octo-detail-sheet">
				<SheetHeader>
					<SheetTitle>{bot?.name ?? "Bot 详情"}</SheetTitle>
					<SheetDescription>
						{bot?.revoked ? "该密钥已吊销，仅展示历史数据。" : "所选区间内的操作与调用明细。"}
					</SheetDescription>
				</SheetHeader>
				<Grid columns={1} gap="md">
					<DetailStats
						items={[
							{ label: "记忆操作", value: formatNumber(detail.totals.ops) },
							{ label: "接口调用", value: formatNumber(detail.totals.calls) },
							{ label: "写入请求", value: formatNumber(detail.totals.writes) },
							{ label: "错误率", value: formatPercent(detail.totals.errorRate, 1) },
						]}
					/>
					<OperationTrendChart rows={detail.series} />
					<dl className="octo-detail-list" aria-label="Bot 操作的空间">
						{detail.spaces.length ? (
							detail.spaces.map((space) => (
								<DetailRow
									key={space.id}
									label={space.name}
									value={`${formatNumber(space.ops)} 次 · ${formatNumber(space.memories)} 条记忆`}
								/>
							))
						) : (
							<DetailRow label="没有记忆操作" value="仅接口调用" />
						)}
					</dl>
				</Grid>
			</SheetContent>
		</Sheet>
	);
}

function SpaceSheet({ detail, onClose }: { detail: SpaceDetail; onClose: () => void }) {
	return (
		<Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent side="right" className="octo-detail-sheet">
				<SheetHeader>
					<SheetTitle>{detail.space?.name ?? "空间详情"}</SheetTitle>
					<SheetDescription>{detail.space?.slug ?? ""}</SheetDescription>
				</SheetHeader>
				<Grid columns={1} gap="md">
					<DetailStats
						items={[
							{ label: "有效记忆", value: formatNumber(detail.totals.memories) },
							{ label: "回收站", value: formatNumber(detail.totals.trash) },
							{ label: "区间操作", value: formatNumber(detail.totals.ops) },
							{ label: "区间净增", value: signed(detail.totals.net) },
						]}
					/>
					<OperationTrendChart rows={detail.series} />
					{detail.types.length ? (
						<OverviewDonut
							data={detail.types}
							ariaLabel="该空间的记忆类型分布"
							summary={<span className="sr-only">该空间内有效记忆按类型分布。</span>}
						/>
					) : null}
					<dl className="octo-detail-list" aria-label="该空间的操作者">
						{detail.bots.map((bot) => (
							<DetailRow key={bot.id} label={bot.name} value={`${formatNumber(bot.ops)} 次操作`} />
						))}
					</dl>
				</Grid>
			</SheetContent>
		</Sheet>
	);
}

export function OverviewPage() {
	const model = useMemo(() => new OverviewModel(), []);
	const state = useModel(model);
	const [params, setParams] = useSearchParams();
	const range = parseOverviewRange(params);
	const botId = params.get("bot");
	const spaceId = params.get("space");
	const data = state.data;
	const series = useMemo(() => (data ? dailySeries(data) : []), [data]);
	useEffect(() => {
		void model.load(range);
	}, [model, range]);
	const update = (key: string, value: string | null) => {
		const next = new URLSearchParams(params);
		if (value === null) next.delete(key);
		else next.set(key, value);
		setParams(next, { replace: true });
	};
	const select = (kind: "bot" | "space", id: string) => {
		const next = new URLSearchParams(params);
		next.delete(kind === "bot" ? "space" : "bot");
		next.set(kind, id);
		setParams(next, { replace: true });
	};
	const closeDetail = () => {
		const next = new URLSearchParams(params);
		next.delete("bot");
		next.delete("space");
		setParams(next, { replace: true });
	};
	const bots = data ? topBots(data) : [];
	const spaces = data ? topSpaces(data) : [];
	const types = data ? typeDistribution(data) : [];
	const opTotals = data ? operationTotals(series) : [];
	const operations = data ? spaceOperations(data) : null;
	const botOps = data ? botOperations(data) : null;
	const calls = data ? botCalls(data) : null;
	const stats = data ? summary(data, series) : null;
	const detailBot = data && botId ? botDetail(data, botId) : null;
	const detailSpace = data && spaceId ? spaceDetail(data, spaceId) : null;
	const quiet =
		Boolean(stats) && stats?.ops === 0 && stats?.calls === 0 && data?.totals.memories === 0;
	return (
		<Grid columns={1} gap="lg">
			<PageHeader
				title="总览"
				meta={
					data
						? `近 ${range} 天 · ${data.totals.spaces} 个空间 · 回收站 ${formatNumber(data.totals.trash)} · UTC`
						: `近 ${range} 天 · UTC`
				}
				actions={
					<>
						<ToggleGroup
							type="single"
							aria-label="时间范围"
							value={String(range)}
							onValueChange={(value) => {
								if (value) update("range", value);
							}}
						>
							{OVERVIEW_RANGES.map((option) => (
								<ToggleGroupItem key={option} value={String(option)}>
									{option} 天
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						<Button
							variant="secondary"
							disabled={state.loading}
							onClick={() => void model.load(range)}
						>
							<RefreshCw aria-hidden="true" />
							刷新
						</Button>
					</>
				}
			/>
			{state.error ? (
				<Banner
					variant="error"
					role="alert"
					icon={<AlertCircle aria-hidden="true" />}
					description={state.error}
					action={
						<Button
							size="sm"
							variant="outline"
							disabled={state.loading}
							onClick={() => void model.load(range)}
						>
							<RefreshCw size={16} aria-hidden="true" />
							重试
						</Button>
					}
				/>
			) : null}
			<StatStrip
				loading={!data}
				items={[
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-blue-foreground">
								<BookOpen aria-hidden="true" />
								有效记忆
							</span>
						),
						value: formatNumber(data?.totals.memories ?? null),
					},
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-teal-foreground">
								<Activity aria-hidden="true" />近 {range} 天操作
							</span>
						),
						value: formatNumber(stats?.ops ?? null),
					},
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-violet-foreground">
								<TrendingUp aria-hidden="true" />
								区间净增
							</span>
						),
						value: stats ? signed(stats.net) : "—",
					},
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-amber-foreground">
								<Bot aria-hidden="true" />
								活跃 Bot
							</span>
						),
						value: stats ? `${formatNumber(stats.activeBots)} / ${formatNumber(stats.bots)}` : "—",
					},
				]}
			/>
			{!data && !state.error ? <LayerCard.Loading label="正在汇总总览" /> : null}
			{quiet ? (
				<LayerCard>
					<LayerCard.Empty
						icon={<ChartNoAxesCombined aria-hidden="true" />}
						title="还没有活动数据"
						description="智能体开始读写记忆后，这里会显示操作趋势、类型分布与排行。"
					/>
				</LayerCard>
			) : null}
			{data && !quiet ? (
				<>
					<SectionRule
						variant="label"
						title="操作趋势"
						hint="来自记忆变更流与每日用量汇总，按 UTC 日聚合"
					>
						<Grid
							columns={2}
							gap="md"
							className="octo-overview-pair"
							style={{ gridTemplateColumns: "var(--octo-grid-columns)" }}
						>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										按操作类型
									</Text>
									<Text size="xs" tone="muted">
										日均 {formatNumber(stats?.dailyOps ?? null)} 次
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									<OperationTrendChart rows={series} />
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										按空间
									</Text>
									<Text size="xs" tone="muted">
										操作量前 {Math.min(5, data.totals.spaces)} 个空间
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									{operations ? <SpaceTrendChart data={operations} /> : null}
								</LayerCard.Body>
							</LayerCard>
						</Grid>
					</SectionRule>
					<SectionRule
						variant="label"
						title="Bot 活动"
						hint="记忆操作按密钥归集，接口调用与错误来自每日用量汇总"
					>
						<Grid
							columns={2}
							gap="md"
							className="octo-overview-pair"
							style={{ gridTemplateColumns: "var(--octo-grid-columns)" }}
						>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										操作与调用
									</Text>
									<Text size="xs" tone="muted">
										堆叠为操作，折线为调用
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									{botOps ? <BotOperationChart data={botOps} rows={series} /> : null}
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										调用与错误率
									</Text>
									<Text size="xs" tone="muted">
										堆叠为调用，折线为错误率
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									{calls ? <BotCallChart data={calls} rows={series} /> : null}
								</LayerCard.Body>
							</LayerCard>
						</Grid>
					</SectionRule>
					<SectionRule
						variant="label"
						title="分布"
						hint="当前有效记忆（不含回收站）与所选区间的操作构成"
					>
						<Grid
							columns={3}
							gap="md"
							className="octo-overview-trio"
							style={{ gridTemplateColumns: "var(--octo-grid-columns)" }}
						>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										记忆类型
									</Text>
									<Text size="xs" tone="muted">
										{formatNumber(data.totals.memories)} 条
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									<OverviewDonut
										data={types}
										ariaLabel="记忆类型分布"
										summary={<span className="sr-only">全部有效记忆按类型分布。</span>}
									/>
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										空间分布
									</Text>
									<Text size="xs" tone="muted">
										前 6 个空间
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									<OverviewDonut
										data={spaceDistribution(data)}
										ariaLabel="记忆空间分布"
										summary={<span className="sr-only">全部有效记忆按空间分布。</span>}
									/>
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										操作构成
									</Text>
									<Text size="xs" tone="muted">
										{formatNumber(stats?.ops ?? null)} 次
									</Text>
								</LayerCard.Header>
								<LayerCard.Body>
									<OverviewDonut
										data={opTotals}
										ariaLabel="操作构成分布"
										summary={<span className="sr-only">所选区间内的记忆操作按类型分布。</span>}
										colorOf={opColorOf}
									/>
								</LayerCard.Body>
							</LayerCard>
						</Grid>
					</SectionRule>
					<SectionRule variant="label" title="排行" hint="点击任意条目查看该 Bot 或空间的详细趋势">
						<Grid
							columns={2}
							gap="md"
							className="octo-overview-pair"
							style={{ gridTemplateColumns: "var(--octo-grid-columns)" }}
						>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										Top Bot
									</Text>
									<TagBadge name={`${bots.length} 个`} color="info" size="sm" />
								</LayerCard.Header>
								<LayerCard.Body>
									<BotsPanel rows={bots} onSelect={(id) => select("bot", id)} />
								</LayerCard.Body>
							</LayerCard>
							<LayerCard>
								<LayerCard.Header>
									<Text as="h3" variant="heading" size="sm">
										Top Space
									</Text>
									<TagBadge name={`${spaces.length} 个`} color="success" size="sm" />
								</LayerCard.Header>
								<LayerCard.Body>
									<SpacesPanel rows={spaces} onSelect={(id) => select("space", id)} />
								</LayerCard.Body>
							</LayerCard>
						</Grid>
					</SectionRule>
				</>
			) : null}
			{detailBot ? <BotSheet detail={detailBot} onClose={closeDetail} /> : null}
			{detailSpace ? <SpaceSheet detail={detailSpace} onClose={closeDetail} /> : null}
		</Grid>
	);
}
