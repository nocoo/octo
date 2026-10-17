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
import { Grid } from "@nocoo/basalt/components/grid";
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
import {
	Activity,
	AlertCircle,
	ArrowUpRight,
	BookOpen,
	KeyRound,
	Network,
	RefreshCw,
	Search,
} from "lucide-react";
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
		<Table aria-label="按日期和智能体统计的调用量">
			<TableHeader>
				<TableRow>
					<TableHead>日期</TableHead>
					<TableHead>智能体</TableHead>
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
		<Grid columns={1} gap="lg">
			<PageHeader
				title="总览"
				actions={
					<Button variant="secondary" disabled={state.loading} onClick={() => void model.load()}>
						<RefreshCw size={16} />
						刷新
					</Button>
				}
			/>
			{state.error && (
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
							onClick={() => void model.load()}
						>
							<RefreshCw size={16} aria-hidden="true" />
							重试
						</Button>
					}
				/>
			)}
			<StatStrip
				items={[
					{ label: "记忆总数", value: state.memoryCount ?? "—" },
					{ label: "今日活跃智能体 · UTC", value: active },
					{ label: "待同步向量", value: state.usage?.health.vector_backlog ?? "—" },
				]}
			/>
			<LayerCard>
				<LayerCard.Header>
					<h2>智能体活动</h2>
				</LayerCard.Header>
				<LayerCard.Well>
					<Grid columns={1}>
						{state.usage && !activity.heatmap.length ? (
							<LayerCard.Empty
								icon={<Activity aria-hidden="true" />}
								title="暂无调用记录"
								description="智能体开始使用后，这里会显示每日活动。"
								action={
									<Button asChild>
										<Link to="/keys">
											<KeyRound size={16} aria-hidden="true" />
											管理密钥
										</Link>
									</Button>
								}
							/>
						) : state.usage ? (
							<HeatmapCalendar
								data={activity.heatmap}
								year={new Date().getUTCFullYear()}
								locale="zh-CN"
								ariaLabel="全年智能体调用活动"
								metricLabel="次调用"
								lessLabel="少"
								moreLabel="多"
							/>
						) : (
							<p className="text-basalt-sm text-basalt-muted-foreground" role="status">
								{state.loading ? "正在读取活动记录…" : "活动数据尚未加载"}
							</p>
						)}
					</Grid>
				</LayerCard.Well>
			</LayerCard>
			<Grid
				style={{
					gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, var(--basalt-space-80)), 1fr))",
				}}
			>
				<LayerCard>
					<LayerCard.Header>
						<h2>调用趋势</h2>
					</LayerCard.Header>
					<LayerCard.Well>
						<Grid columns={1}>
							{activity.rows.length ? (
								<AreaChart
									data={activity.rows}
									series={activityChartSeries(activity)}
									stacked
									showAxes
									showLegend
									className="h-basalt-80 w-full"
									ariaLabel="按智能体堆叠的每日调用量"
									summary="每日接口调用次数，纵轴从零开始。"
								/>
							) : state.usage ? (
								<LayerCard.Empty
									icon={<Activity aria-hidden="true" />}
									title="暂无调用趋势"
									action={
										<Button asChild>
											<Link to="/keys">
												<KeyRound size={16} aria-hidden="true" />
												管理密钥
											</Link>
										</Button>
									}
								/>
							) : (
								<p className="text-basalt-sm text-basalt-muted-foreground">
									{state.loading ? "正在读取调用记录…" : "调用数据尚未加载"}
								</p>
							)}
							<Collapsible>
								<CollapsibleTrigger>查看活动数据表</CollapsibleTrigger>
								<CollapsibleContent unstyled>{table}</CollapsibleContent>
							</Collapsible>
						</Grid>
					</LayerCard.Well>
				</LayerCard>
				<LayerCard>
					<LayerCard.Header>
						<h2>知识入口</h2>
					</LayerCard.Header>
					<LayerCard.Body>
						<Grid columns={1}>
							<Grid
								gap="sm"
								style={{
									gridTemplateColumns:
										"repeat(auto-fit, minmax(min(100%, var(--basalt-space-36)), 1fr))",
								}}
							>
								<Button asChild>
									<Link to="/memories">
										浏览记忆 <ArrowUpRight size={16} />
									</Link>
								</Button>
								<Button variant="secondary" asChild>
									<Link to="/search">
										<Search size={16} aria-hidden="true" />
										混合搜索
									</Link>
								</Button>
								<Button variant="secondary" asChild>
									<Link to="/graph">
										<Network size={16} aria-hidden="true" />
										探索关系
									</Link>
								</Button>
							</Grid>
							<p className="text-basalt-sm text-basalt-muted-foreground">
								⌘ K 快速跳转，/ 开始搜索。
							</p>
						</Grid>
					</LayerCard.Body>
				</LayerCard>
			</Grid>
			<SectionRule title="最近更新的记忆">
				<LayerCard>
					<LayerCard.Body>
						<Grid columns={1}>
							<Table aria-label="最近更新的记忆">
								<TableHeader>
									<TableRow>
										<TableHead>记忆</TableHead>
										<TableHead>空间</TableHead>
										<TableHead>更新时间</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{state.recent.map((memory) => (
										<TableRow key={memory.id}>
											<TableCell>
												<Link to={`/memories/${encodeURIComponent(memory.id)}`}>
													{memory.title}
												</Link>
											</TableCell>
											<TableCell>
												<Badge variant="secondary">{memory.space}</Badge>
											</TableCell>
											<TableCell>{new Date(memory.updated_at).toLocaleString("zh-CN")}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{!state.recent.length &&
								(state.memoryCount !== null ? (
									<LayerCard.Empty
										icon={<BookOpen aria-hidden="true" />}
										title="还没有记忆"
										description="从第一条记忆开始整理知识。"
										action={
											<Button asChild>
												<Link to="/memories">
													<ArrowUpRight size={16} aria-hidden="true" />
													浏览记忆
												</Link>
											</Button>
										}
									/>
								) : (
									<p className="text-basalt-sm text-basalt-muted-foreground">
										{state.loading ? "正在读取记忆…" : "记忆数据尚未加载。"}
									</p>
								))}
						</Grid>
					</LayerCard.Body>
				</LayerCard>
			</SectionRule>
		</Grid>
	);
}
