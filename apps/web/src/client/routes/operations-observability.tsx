import { Badge, Button, Field, Input, LayerCard, ScrollArea, toast } from "@nocoo/basalt";
import { LineChart } from "@nocoo/basalt/charts/line";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import {
	ArrowDown,
	ChartNoAxesCombined,
	CircleAlert,
	Download,
	Filter,
	RefreshCw,
	ScrollText,
	X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
import { operationsError } from "../viewmodels/operations-errors";
import {
	AuditModel,
	auditQuery,
	parseAuditFilters,
	parseUsageFilters,
	type UsageDaily,
	UsageModel,
	usageQuery,
	virtualWindow,
} from "../viewmodels/operations-observability";
import "./operations.css";

export function UsagePage() {
	const [model] = useState(() => new UsageModel());
	const state = useModel(model);
	const [params, setParams] = useSearchParams();
	const search = params.toString();
	const filters = parseUsageFilters(search);
	useEffect(() => {
		void model.load(search);
	}, [model, search]);
	useEffect(() => () => model.dispose(), [model]);
	const columns: DataTableColumn<UsageDaily & { error_rate: number }>[] = [
		{
			id: "day",
			header: "日期",
			sortValue: (row) => Date.parse(row.day),
			accessor: (row) => row.day,
		},
		{ id: "key", header: "密钥", accessor: (row) => row.key_id },
		{
			id: "calls",
			header: "调用次数",
			sortValue: (row) => row.calls,
			textAlign: "end",
			accessor: (row) => row.calls.toLocaleString("zh-CN"),
		},
		{
			id: "errors",
			header: "错误次数",
			sortValue: (row) => row.errors,
			textAlign: "end",
			accessor: (row) => row.errors.toLocaleString("zh-CN"),
		},
		{
			id: "rate",
			header: "错误率",
			sortValue: (row) => row.error_rate,
			textAlign: "end",
			accessor: (row) => `${row.error_rate.toFixed(2)}%`,
		},
		{
			id: "writes",
			header: "写入次数",
			sortValue: (row) => row.writes,
			textAlign: "end",
			accessor: (row) => row.writes.toLocaleString("zh-CN"),
		},
		{
			id: "bytes_in",
			header: "输入字节",
			sortValue: (row) => row.bytes_in,
			textAlign: "end",
			accessor: (row) => row.bytes_in.toLocaleString("zh-CN"),
		},
		{
			id: "bytes_out",
			header: "输出字节",
			sortValue: (row) => row.bytes_out,
			textAlign: "end",
			accessor: (row) => row.bytes_out.toLocaleString("zh-CN"),
		},
	];
	const alternative = (
		<p className="text-basalt-sm text-basalt-muted-foreground">
			精确数值请查看<a href="#usage-daily-table">每日用量表</a>。
		</p>
	);
	return (
		<Grid columns={1} gap="md" className="min-w-0">
			<PageHeader
				title="每日用量"
				description="按 UTC 日期与密钥展示已汇总数据；不是实时请求统计。"
				actions={
					<Button
						icon={<RefreshCw aria-hidden="true" />}
						variant="outline"
						onClick={() => void model.load(search)}
						disabled={state.loading}
					>
						刷新
					</Button>
				}
				filters={
					<form
						key={search}
						className="w-full"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							setParams(
								usageQuery({
									key_id: String(data.get("key_id") ?? "").trim(),
									from: String(data.get("from") ?? ""),
									to: String(data.get("to") ?? ""),
								}),
							);
						}}
					>
						<Grid
							columns={5}
							gap="sm"
							style={{
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 10rem), 1fr))",
								alignItems: "end",
							}}
						>
							<Field label="密钥标识">
								<Input name="key_id" defaultValue={filters.key_id} autoComplete="off" />
							</Field>
							<Field label="开始日期">
								<Input type="date" name="from" defaultValue={filters.from} />
							</Field>
							<Field label="结束日期">
								<Input type="date" name="to" defaultValue={filters.to} />
							</Field>
							<Button type="submit" icon={<Filter aria-hidden="true" />} variant="outline">
								应用筛选
							</Button>
							<Button
								type="button"
								icon={<X aria-hidden="true" />}
								variant="ghost"
								onClick={() => setParams("")}
							>
								清除筛选
							</Button>
						</Grid>
					</form>
				}
			/>
			{state.error && (
				<p role="alert">
					<CircleAlert className="inline size-basalt-icon" aria-hidden="true" /> {state.error}{" "}
					<Button size="sm" variant="ghost" onClick={() => void model.load(search)}>
						重试
					</Button>
				</p>
			)}
			{state.items.length > 0 ? (
				<Grid
					columns={2}
					gap="sm"
					style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}
				>
					<LayerCard>
						<LayerCard.Header>调用次数</LayerCard.Header>
						<LayerCard.Body>
							<Grid columns={1} gap="sm">
								<LineChart
									className="ops-plot"
									showAxes
									data={model.chart}
									series={[{ key: "calls", label: "调用次数" }]}
									ariaLabel="各密钥的每日调用次数"
									summary="每个点代表一个密钥一天内的值，不跨密钥汇总。"
									dataAlternative={alternative}
								/>
							</Grid>
						</LayerCard.Body>
					</LayerCard>
					<LayerCard>
						<LayerCard.Header>错误率</LayerCard.Header>
						<LayerCard.Body>
							<Grid columns={1} gap="sm">
								<LineChart
									className="ops-plot"
									showAxes
									yDomain={[0, 100]}
									data={model.chart}
									series={[{ key: "error_rate", label: "错误率（%）" }]}
									ariaLabel="各密钥的每日错误率"
									valueFormatter={(value) => `${value.toFixed(1)}%`}
									summary="各密钥每天错误调用所占比例。"
									dataAlternative={alternative}
								/>
							</Grid>
						</LayerCard.Body>
					</LayerCard>
				</Grid>
			) : null}
			<LayerCard id="usage-daily-table">
				<LayerCard.Header>每日用量与图表数据</LayerCard.Header>
				{state.loading && state.items.length === 0 ? (
					<LayerCard.Loading label="正在加载每日用量" />
				) : (
					<DataTable
						aria-label="每日用量表"
						data={model.rows}
						columns={columns}
						getRowId={(row) => `${row.key_id}/${row.day}`}
						edge="attached"
						error={state.items.length === 0 ? state.error : null}
						retryLabel="重试"
						onRetry={() => void model.load(search)}
						empty={
							state.loaded ? (
								<LayerCard.Empty
									icon={<ChartNoAxesCombined aria-hidden="true" />}
									title="此范围内暂无用量"
									description="暂无每日用量记录。请调整筛选或发起接口请求。"
									action={
										<Button icon={<X aria-hidden="true" />} onClick={() => setParams("")}>
											清除筛选
										</Button>
									}
								/>
							) : (
								"每日用量尚未加载，请刷新。"
							)
						}
					/>
				)}
				<LayerCard.Footer>
					<Button
						icon={<ArrowDown aria-hidden="true" />}
						variant="outline"
						disabled={!state.nextCursor || state.loading}
						loading={state.loadingMore}
						onClick={() => void model.loadMore()}
					>
						加载更多
					</Button>
					<span className="text-basalt-sm text-basalt-muted-foreground">
						{state.nextCursor
							? "还有更多记录"
							: state.loaded && !state.loading && !state.error
								? "已加载全部查询结果"
								: "查询是否完成尚不确定"}
					</span>
				</LayerCard.Footer>
			</LayerCard>
		</Grid>
	);
}

export function AuditPage() {
	const [model] = useState(() => new AuditModel());
	const state = useModel(model);
	const [params, setParams] = useSearchParams();
	const search = params.toString();
	const filters = parseAuditFilters(search);
	const viewport = useRef<HTMLDivElement>(null);
	const table = useRef<HTMLTableElement>(null);
	const [geometry, setGeometry] = useState({ top: 0, height: 480, row: 36 });
	const window = virtualWindow(state.items.length, geometry.top, geometry.height, geometry.row);
	useEffect(() => {
		if (viewport.current) viewport.current.scrollTop = 0;
		setGeometry((current) => ({ ...current, top: 0 }));
		void model.load(search);
	}, [model, search]);
	useEffect(() => () => model.dispose(), [model]);
	useLayoutEffect(() => {
		const container = viewport.current;
		if (!container) return;
		const measure = () => {
			const row =
				state.items.length > 0
					? table.current?.querySelector("[data-audit-row]")?.getBoundingClientRect().height
					: undefined;
			setGeometry((current) => ({
				...current,
				height: container.clientHeight,
				row: row || current.row,
			}));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, [state.items.length]);
	return (
		<Grid columns={1} gap="md" className="min-w-0">
			<PageHeader
				title="审计日志"
				description="包含被拒绝的请求；不记录请求正文和凭据。"
				actions={
					<>
						<Button
							icon={<RefreshCw aria-hidden="true" />}
							variant="outline"
							onClick={() => void model.load(search)}
							disabled={state.loading}
						>
							刷新
						</Button>
						<Button
							icon={<Download aria-hidden="true" />}
							loading={state.exporting}
							onClick={async () => {
								const csv = await model.exportCsv();
								if (csv === null) return;
								const url = URL.createObjectURL(
									new Blob([csv], { type: "text/csv;charset=utf-8" }),
								);
								const link = document.createElement("a");
								link.href = url;
								link.download = "octo-audit.csv";
								document.body.append(link);
								link.click();
								link.remove();
								setTimeout(() => URL.revokeObjectURL(url), 0);
								toast.success("审计 CSV 已导出。");
							}}
						>
							导出 CSV
						</Button>
					</>
				}
				filters={
					<form
						key={search}
						className="w-full"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							setParams(
								auditQuery({
									actor: String(data.get("actor") ?? "").trim(),
									action: String(data.get("action") ?? "").trim(),
									status: String(data.get("status") ?? ""),
									from: String(data.get("from") ?? ""),
									to: String(data.get("to") ?? ""),
								}),
							);
						}}
					>
						<Grid
							columns={7}
							gap="sm"
							style={{
								gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
								alignItems: "end",
							}}
						>
							<Field label="调用者">
								<Input name="actor" defaultValue={filters.actor} autoComplete="off" />
							</Field>
							<Field label="路由模板">
								<Input name="action" defaultValue={filters.action} autoComplete="off" />
							</Field>
							<Field label="状态码">
								<Input
									name="status"
									type="number"
									min={100}
									max={599}
									step={1}
									defaultValue={filters.status}
								/>
							</Field>
							<Field label="开始日期">
								<Input name="from" type="date" defaultValue={filters.from.slice(0, 10)} />
							</Field>
							<Field label="结束日期">
								<Input name="to" type="date" defaultValue={filters.to.slice(0, 10)} />
							</Field>
							<Button type="submit" icon={<Filter aria-hidden="true" />} variant="outline">
								应用筛选
							</Button>
							<Button
								type="button"
								icon={<X aria-hidden="true" />}
								variant="ghost"
								onClick={() => setParams("")}
							>
								清除筛选
							</Button>
						</Grid>
					</form>
				}
			/>
			{state.error && (
				<p role="alert">
					<CircleAlert className="inline size-basalt-icon" aria-hidden="true" /> {state.error}{" "}
					<Button variant="ghost" size="sm" onClick={() => void model.load(search)}>
						重试
					</Button>
				</p>
			)}
			{state.loading && <p role="status">正在刷新审计日志……</p>}
			<SectionRule
				title="请求记录"
				actions={
					<span className="text-basalt-sm text-basalt-muted-foreground">
						{state.loaded
							? `${state.items.length.toLocaleString("zh-CN")} 条已加载记录`
							: "审计记录尚未加载"}
					</span>
				}
			>
				<LayerCard padding="none">
					<ScrollArea
						ref={viewport}
						orientation="both"
						className={state.items.length ? "ops-audit-scroll" : ""}
						tabIndex={0}
						aria-label="可滚动的审计记录"
						onScroll={(event) => {
							const top = event.currentTarget.scrollTop;
							setGeometry((current) => ({ ...current, top }));
						}}
					>
						<Table
							ref={table}
							className="ops-audit-table"
							aria-label="审计记录"
							aria-rowcount={state.items.length + 1}
						>
							<TableCaption>
								本地时间；使用方向键或向下翻页键滚动，点击“加载更多”获取下一页。
							</TableCaption>
							<TableHeader>
								<TableRow>
									{["时间", "调用者", "请求方法", "路由", "状态码", "耗时", "请求标识"].map(
										(label) => (
											<TableHead
												key={label}
												textAlign={label === "耗时" ? "end" : "start"}
												className={
													label === "时间"
														? "ps-basalt-table-edge"
														: label === "请求标识"
															? "pe-basalt-table-edge"
															: ""
												}
											>
												{label}
											</TableHead>
										),
									)}
								</TableRow>
							</TableHeader>
							<TableBody>
								{window.before > 0 && (
									<TableRow aria-hidden="true">
										<TableCell
											colSpan={7}
											className="ops-spacer"
											style={{ height: window.before }}
										/>
									</TableRow>
								)}
								{state.items.slice(window.start, window.end).map((row, index) => (
									<TableRow key={row.id} data-audit-row="" aria-rowindex={window.start + index + 2}>
										<TableCell className="ps-basalt-table-edge">
											{new Date(row.at).toLocaleString("zh-CN")}
										</TableCell>
										<TableCell>{row.actor}</TableCell>
										<TableCell>{row.method}</TableCell>
										<TableCell>{row.route}</TableCell>
										<TableCell>
											<Badge variant={row.status >= 400 ? "secondary" : "success"}>
												{row.status}
											</Badge>
											{row.error_code && (
												<span className="text-basalt-sm text-basalt-muted-foreground">
													{" "}
													{operationsError(row.error_code)}
												</span>
											)}
										</TableCell>
										<TableCell textAlign="end">{row.duration_ms} 毫秒</TableCell>
										<TableCell className="pe-basalt-table-edge">{row.request_id}</TableCell>
									</TableRow>
								))}
								{window.after > 0 && (
									<TableRow aria-hidden="true">
										<TableCell
											colSpan={7}
											className="ops-spacer"
											style={{ height: window.after }}
										/>
									</TableRow>
								)}
								{state.items.length === 0 && !state.loading && (
									<TableRow>
										<TableCell colSpan={7} className="ps-basalt-table-edge pe-basalt-table-edge">
											{state.error ? (
												"审计记录暂不可用，请重试查询。"
											) : state.loaded ? (
												<LayerCard.Empty
													icon={<ScrollText aria-hidden="true" />}
													title="没有符合筛选条件的审计记录"
													description="调整筛选后再次查询。"
													action={
														<Button icon={<X aria-hidden="true" />} onClick={() => setParams("")}>
															清除筛选
														</Button>
													}
												/>
											) : (
												"审计记录尚未加载，请刷新。"
											)}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</ScrollArea>
					<LayerCard.Footer>
						<Button
							icon={<ArrowDown aria-hidden="true" />}
							variant="outline"
							disabled={!state.nextCursor || state.loading}
							loading={state.loadingMore}
							onClick={() => void model.loadMore()}
						>
							加载更多
						</Button>
						<span className="text-basalt-sm text-basalt-muted-foreground">
							{state.nextCursor
								? "还有更多记录"
								: state.loaded && !state.loading && !state.error
									? "已加载全部查询结果"
									: "查询是否完成尚不确定"}
						</span>
					</LayerCard.Footer>
				</LayerCard>
			</SectionRule>
		</Grid>
	);
}
