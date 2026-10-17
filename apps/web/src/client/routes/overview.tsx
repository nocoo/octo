import { Badge, Button, LayerCard, StatStrip } from "@nocoo/basalt";
import { AreaChart } from "@nocoo/basalt/charts/area";
import { type ChartSeriesDescriptor, getChartColor } from "@nocoo/basalt/charts/config";
import { HeatmapCalendar } from "@nocoo/basalt/charts/heatmap-calendar";
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
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
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { useModel } from "../components/layout/use-model";
import { activitySeries, OverviewModel } from "../viewmodels/overview";

export function activityChartSeries(activity: ReturnType<typeof activitySeries>) {
	return activity.keys.map(
		(key, index) =>
			({
				key: `agent_${index}` as const,
				label: key,
				color: getChartColor(activity.colors[index] ?? 0),
			}) satisfies ChartSeriesDescriptor,
	);
}

export function OverviewPage() {
	const model = useMemo(() => new OverviewModel(), []);
	const state = useModel(model);
	useEffect(() => {
		void model.load();
	}, [model]);
	const activity = activitySeries(state.usage?.daily ?? []);
	const today = new Date().toISOString().slice(0, 10);
	const active = state.usage
		? new Set(
				state.usage.daily
					.filter((row) => row.day === today && row.calls > 0)
					.map((row) => row.key_id),
			).size
		: "—";
	const table = (
		<Table aria-label="按日与 Agent 的调用量">
			<TableHeader>
				<TableRow>
					<TableHead>日期</TableHead>
					<TableHead>Agent</TableHead>
					<TableHead>调用</TableHead>
					<TableHead>错误</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{state.usage?.daily.map((row) => (
					<TableRow key={`${row.day}:${row.key_id}`}>
						<TableCell>{row.day}</TableCell>
						<TableCell>{row.key_id}</TableCell>
						<TableCell>{row.calls}</TableCell>
						<TableCell>{row.errors}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
	return (
		<div className="octo-page">
			<PageHeader
				title="总览"
				description="每一条记忆，都有迹可循。"
				actions={
					<Button variant="secondary" disabled={state.loading} onClick={() => void model.load()}>
						<RefreshCw size={16} />
						刷新
					</Button>
				}
			/>
			{state.error && <Banner variant="error" role="alert" description={state.error} />}
			<StatStrip
				items={[
					{ label: "记忆总数", value: state.memoryCount ?? "—" },
					{ label: "今日活跃 Agent · UTC", value: active },
					{ label: "待同步向量", value: state.usage?.health.vector_backlog ?? "—" },
				]}
			/>
			<LayerCard>
				<LayerCard.Header>
					<h2>Agent 活动</h2>
				</LayerCard.Header>
				<LayerCard.Body>
					{state.usage ? (
						<HeatmapCalendar
							data={activity.heatmap}
							year={new Date().getUTCFullYear()}
							locale="zh-CN"
							ariaLabel="全年 Agent 调用活动"
							metricLabel="次调用"
							lessLabel="少"
							moreLabel="多"
						/>
					) : (
						<p className="octo-muted" role="status">
							{state.loading ? "正在读取活动记录…" : "活动数据尚未加载"}
						</p>
					)}
				</LayerCard.Body>
			</LayerCard>
			<div className="octo-grid">
				<LayerCard>
					<LayerCard.Header>
						<h2>调用趋势</h2>
					</LayerCard.Header>
					<LayerCard.Body>
						{activity.rows.length ? (
							<AreaChart
								data={activity.rows}
								series={activityChartSeries(activity)}
								stacked
								showAxes
								showLegend
								className="octo-chart"
								ariaLabel="按 Agent 堆叠的每日调用量"
								summary="每日 API 调用次数，纵轴从零开始。"
							/>
						) : (
							<p className="octo-muted">调用记录会显示在这里。</p>
						)}
						<Collapsible>
							<CollapsibleTrigger>查看活动数据表</CollapsibleTrigger>
							<CollapsibleContent unstyled>{table}</CollapsibleContent>
						</Collapsible>
					</LayerCard.Body>
				</LayerCard>
				<LayerCard>
					<LayerCard.Header>
						<h2>知识入口</h2>
					</LayerCard.Header>
					<LayerCard.Body>
						<div className="octo-actions">
							<Button asChild>
								<Link to="/memories">
									浏览记忆 <ArrowUpRight size={16} />
								</Link>
							</Button>
							<Button variant="secondary" asChild>
								<Link to="/search">混合搜索</Link>
							</Button>
							<Button variant="secondary" asChild>
								<Link to="/graph">探索关系</Link>
							</Button>
						</div>
						<p className="octo-muted">
							使用 ⌘ K 快速跳转，按 / 开始搜索。内容、版本与访问记录都保留在你的工作台。
						</p>
					</LayerCard.Body>
				</LayerCard>
			</div>
			<SectionRule title="最近更新的记忆" />
			<LayerCard>
				<LayerCard.Body>
					<Table aria-label="最近更新的记忆">
						<TableHeader>
							<TableRow>
								<TableHead>记忆</TableHead>
								<TableHead>Space</TableHead>
								<TableHead>更新时间</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{state.recent.map((memory) => (
								<TableRow key={memory.id}>
									<TableCell>
										<Link to={`/memories/${encodeURIComponent(memory.id)}`}>{memory.title}</Link>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">{memory.space}</Badge>
									</TableCell>
									<TableCell>{new Date(memory.updated_at).toLocaleString("zh-CN")}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{!state.recent.length && (
						<p className="octo-muted">
							{state.loading
								? "正在读取记忆…"
								: state.error
									? "记忆数据尚未加载。"
									: "还没有记忆。"}
						</p>
					)}
				</LayerCard.Body>
			</LayerCard>
		</div>
	);
}
