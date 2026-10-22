import { Button, LayerCard, StatStrip } from "@nocoo/basalt";
import { AreaChart } from "@nocoo/basalt/charts/area";
import { type ChartSeriesDescriptor, getChartColor } from "@nocoo/basalt/charts/config";
import { HeatmapCalendar } from "@nocoo/basalt/charts/heatmap-calendar";
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { DataTable } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
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
	Activity,
	AlertCircle,
	ArrowUpRight,
	BookOpen,
	KeyRound,
	Network,
	PenLine,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { PageHeader } from "../components/layout/page-header";
import { useModel } from "../components/layout/use-model";
import { RecordTime } from "../components/record-display";
import { formatNumber } from "../lib/format";
import { activitySeries, OverviewModel } from "../viewmodels/overview";

const changeLabels = new Map([
	["created", "创建"],
	["updated", "更新"],
	["deleted", "删除"],
	["trashed", "移入回收站"],
	["purged", "永久删除"],
	["moved", "移动"],
	["restored", "恢复"],
	["rolled_back", "回滚"],
	["tag_renamed", "重命名标签"],
	["tag_merged", "合并标签"],
]);

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
	const activity = activitySeries(state.usage ?? []);
	const table = (
		<Table className="octo-table" aria-label="按日期和智能体统计的调用量">
			<TableHeader>
				<TableRow>
					<TableHead>日期</TableHead>
					<TableHead>智能体</TableHead>
					<TableHead textAlign="end">调用</TableHead>
					<TableHead textAlign="end">错误</TableHead>
					<TableHead textAlign="end">写入次数</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{state.usage?.map((row) => (
					<TableRow key={`${row.day}:${row.key_id}`}>
						<TableCell>{row.day}</TableCell>
						<TableCell>
							<TagBadge name={row.key_id} size="sm" />
						</TableCell>
						<TableCell textAlign="end">{formatNumber(row.calls)}</TableCell>
						<TableCell textAlign="end">{formatNumber(row.errors)}</TableCell>
						<TableCell textAlign="end">{formatNumber(row.writes)}</TableCell>
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
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-blue-foreground">
								<BookOpen aria-hidden="true" />
								有效记忆数
							</span>
						),
						value: formatNumber(state.memoryCount),
					},
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-teal-foreground">
								<PenLine aria-hidden="true" />
								今日写入次数 · UTC 小时汇总
							</span>
						),
						value: formatNumber(state.writesToday),
					},
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-violet-foreground">
								<KeyRound aria-hidden="true" />
								今日调用密钥 · UTC 小时汇总
							</span>
						),
						value: formatNumber(state.activeKeysToday),
					},
					{
						label: (
							<span className="octo-stat-label text-basalt-tag-amber-foreground">
								<Trash2 aria-hidden="true" />
								回收站记忆数
							</span>
						),
						value: formatNumber(state.trashCount),
					},
				]}
			/>
			<p className="text-basalt-sm text-basalt-muted-foreground" role="status">
				调用与写入次数来自本年度 UTC 小时汇总，非实时数据，也不等同于新增记忆数。
				当前接口未提供向量同步积压、D1 体积和定时任务最近运行时间。
			</p>
			<SectionRule variant="heading" title="知识入口">
				<LayerCard>
					<LayerCard.Body>
						<Grid columns={1} gap="sm">
							<Grid
								gap="sm"
								style={{
									gridTemplateColumns:
										"repeat(auto-fit, minmax(min(100%, var(--basalt-space-36)), max-content))",
									justifyContent: "start",
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
			</SectionRule>
			<SectionRule variant="heading" title="智能体活动 · 按密钥小时汇总">
				<LayerCard>
					<LayerCard.Body>
						<Grid columns={1}>
							{state.usage && !activity.heatmap.length ? (
								<LayerCard.Empty
									className="octo-empty"
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
					</LayerCard.Body>
				</LayerCard>
			</SectionRule>
			<SectionRule variant="heading" title="调用趋势">
				<LayerCard>
					<LayerCard.Body>
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
									className="octo-empty"
									icon={<Activity aria-hidden="true" />}
									title="暂无调用趋势"
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
					</LayerCard.Body>
				</LayerCard>
			</SectionRule>
			<SectionRule variant="heading" title="最近变更">
				<LayerCard padding="none">
					<DataTable
						className="octo-table"
						aria-label="最近变更"
						data={state.changes}
						getRowId={(change) => String(change.seq)}
						empty={null}
						edge="attached"
						columns={[
							{
								id: "content",
								header: "内容",
								width: "28ch",
								wrap: true,
								sortable: false,
								accessor: (change) =>
									change.entity === "memory" && !["trashed", "purged"].includes(change.op) ? (
										<Link
											to={`/memories/${encodeURIComponent(change.entity_id)}`}
											className="octo-record-id"
											title={change.entity_id}
										>
											{change.entity_id}
										</Link>
									) : (
										<span className="octo-record-id" title={change.entity_id}>
											{change.entity_id}
										</span>
									),
							},
							{
								id: "operation",
								header: "操作",
								width: "12ch",
								wrap: true,
								sortable: false,
								accessor: (change) => (
									<TagBadge
										name={changeLabels.get(change.op) ?? "其他操作"}
										color={
											["deleted", "trashed", "purged"].includes(change.op)
												? "danger"
												: ["created", "restored"].includes(change.op)
													? "success"
													: "info"
										}
										size="sm"
									/>
								),
							},
							{
								id: "actor",
								header: "操作者",
								width: "28ch",
								wrap: true,
								sortable: false,
								accessor: (change) => <TagBadge name={change.actor ?? "未提供"} size="sm" />,
							},
							{
								id: "time",
								header: "时间 · UTC",
								width: "28ch",
								wrap: true,
								sortable: false,
								accessor: (change) => <RecordTime value={change.at} utc />,
							},
						]}
					/>
					{!state.changes.length && (
						<p className="px-basalt-panel-x py-basalt-panel-y text-basalt-sm text-basalt-muted-foreground">
							{state.memoryCount === null ? "变更记录尚未加载" : "暂无变更记录"}
						</p>
					)}
				</LayerCard>
			</SectionRule>
			<SectionRule variant="heading" title="最近更新的记忆">
				<LayerCard padding="none">
					<DataTable
						className="octo-table"
						aria-label="最近更新的记忆"
						data={state.recent}
						getRowId={(memory) => memory.id}
						empty={null}
						edge="attached"
						columns={[
							{
								id: "title",
								header: "记忆",
								width: "28ch",
								wrap: true,
								sortable: false,
								accessor: (memory) => (
									<Link
										to={`/memories/${encodeURIComponent(memory.id)}`}
										className="octo-record-title"
										title={memory.title}
									>
										{memory.title}
									</Link>
								),
							},
							{
								id: "space",
								header: "空间",
								width: "24ch",
								wrap: true,
								sortable: false,
								accessor: (memory) => <TagBadge name={memory.space} size="sm" />,
							},
							{
								id: "updated",
								header: "更新时间",
								width: "14ch",
								textAlign: "end",
								wrap: true,
								sortable: false,
								accessor: (memory) => <RecordTime value={memory.updated_at} />,
							},
						]}
					/>
					{!state.recent.length &&
						(state.memoryCount !== null ? (
							<LayerCard.Empty
								className="octo-empty"
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
							<p className="px-basalt-panel-x py-basalt-panel-y text-basalt-sm text-basalt-muted-foreground">
								{state.loading ? "正在读取记忆…" : "记忆数据尚未加载。"}
							</p>
						))}
				</LayerCard>
			</SectionRule>
		</Grid>
	);
}
