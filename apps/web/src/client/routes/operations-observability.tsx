import { Button, Field, Input, LayerCard, Link, ScrollArea, toast } from "@nocoo/basalt";
import { BarChart } from "@nocoo/basalt/charts/bar";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { FilterBar, FilterChip } from "@nocoo/basalt/components/filter-bar";
import { Grid } from "@nocoo/basalt/components/grid";
import { Popover, PopoverContent, PopoverTrigger } from "@nocoo/basalt/components/popover";
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
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
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
import { PageHeader } from "../components/layout/page-header";
import { useModel } from "../components/layout/use-model";
import { RecordTime } from "../components/record-display";
import { formatBytes, formatNumber } from "../lib/format";
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

const usageFilterFields = [
	["from", "开始日期"],
	["to", "结束日期"],
	["key_id", "密钥标识"],
] as const;
const auditFilterFields = [
	["from", "开始日期"],
	["to", "结束日期"],
	["status", "状态码"],
	["actor", "调用者"],
	["action", "路由模板"],
] as const;

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
	const columns: DataTableColumn<UsageDaily & { error_rate: number; key_label: string }>[] = [
		{
			id: "day",
			header: "日期",
			width: "16ch",
			sortValue: (row) => Date.parse(row.day),
			accessor: (row) => row.day,
		},
		{
			id: "key",
			header: "密钥",
			width: "18ch",
			sortValue: (row) => row.key_label,
			accessor: (row) => (
				<Link href="/keys" className="octo-record-title">
					{row.key_label}
				</Link>
			),
		},
		{
			id: "calls",
			header: "调用次数",
			width: "12ch",
			sortValue: (row) => row.calls,
			textAlign: "end",
			accessor: (row) => (
				<span className="font-medium text-basalt-tag-blue-foreground">
					{formatNumber(row.calls)}
				</span>
			),
		},
		{
			id: "errors",
			header: "错误次数",
			width: "12ch",
			sortValue: (row) => row.errors,
			textAlign: "end",
			accessor: (row) => (
				<span
					className={row.errors ? "text-basalt-tag-danger-foreground font-medium" : "octo-muted"}
				>
					{formatNumber(row.errors)}
				</span>
			),
		},
		{
			id: "rate",
			header: "错误率",
			width: "12ch",
			sortValue: (row) => row.error_rate,
			textAlign: "end",
			accessor: (row) => (
				<TagBadge
					name={`${row.error_rate.toFixed(2)}%`}
					color={row.errors ? "warning" : "success"}
					size="sm"
				/>
			),
		},
		{
			id: "writes",
			header: "写入次数",
			width: "12ch",
			sortValue: (row) => row.writes,
			textAlign: "end",
			accessor: (row) => formatNumber(row.writes),
		},
		{
			id: "bytes_in",
			header: "输入流量",
			width: "12ch",
			sortValue: (row) => row.bytes_in,
			textAlign: "end",
			accessor: (row) => (
				<span title={`${formatNumber(row.bytes_in)} B`}>{formatBytes(row.bytes_in)}</span>
			),
		},
		{
			id: "bytes_out",
			header: "输出流量",
			width: "12ch",
			sortValue: (row) => row.bytes_out,
			textAlign: "end",
			accessor: (row) => (
				<span title={`${formatNumber(row.bytes_out)} B`}>{formatBytes(row.bytes_out)}</span>
			),
		},
	];
	const alternative = (
		<p className="text-basalt-sm text-basalt-muted-foreground">
			精确数值请查看<Link href="#usage-daily-table">每日用量表</Link>。
		</p>
	);
	return (
		<Grid columns={1} gap="md" className="min-w-0">
			<PageHeader
				title="每日用量"
				meta="按 UTC 日期与密钥汇总；非实时数据"
				actions={
					<>
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="outline" aria-label="用量筛选" title="用量筛选">
									<Filter aria-hidden="true" />
									筛选
									{Object.values(filters).filter(Boolean).length
										? `（${Object.values(filters).filter(Boolean).length}）`
										: ""}
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								style={{ width: "min(36rem, calc(100vw - 2rem))", maxWidth: "calc(100vw - 2rem)" }}
							>
								<form
									key={search}
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
									<FilterBar
										label="用量筛选"
										chips={
											usageFilterFields.some(([key]) => filters[key])
												? usageFilterFields
														.filter(([key]) => filters[key])
														.map(([key, label]) => (
															<FilterChip
																key={key}
																label={label}
																value={filters[key]}
																removeLabel={`移除${label}筛选`}
																onRemove={() => setParams(usageQuery({ ...filters, [key]: "" }))}
															/>
														))
												: undefined
										}
									>
										<Grid columns={1} gap="sm" className="ops-filter-fields">
											<Grid
												columns={2}
												gap="sm"
												className="ops-date-range"
												role="group"
												aria-label="日期范围"
												style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
											>
												<Field label="开始日期">
													<Input
														type="date"
														name="from"
														aria-label="开始日期"
														title="开始日期"
														defaultValue={filters.from}
													/>
												</Field>
												<Field label="结束日期">
													<Input
														type="date"
														name="to"
														aria-label="结束日期"
														title="结束日期"
														defaultValue={filters.to}
													/>
												</Field>
											</Grid>
											<Field label="密钥标识">
												<Input
													className="ops-filter-key"
													name="key_id"
													aria-label="密钥标识"
													title="密钥标识"
													defaultValue={filters.key_id}
													autoComplete="off"
												/>
											</Field>
											<fieldset className="ops-filter-actions" aria-label="筛选操作">
												<Button type="button" variant="ghost" onClick={() => setParams("")}>
													清除筛选
												</Button>
												<Button
													type="submit"
													icon={<Filter aria-hidden="true" />}
													variant="outline"
												>
													应用筛选
												</Button>
											</fieldset>
										</Grid>
									</FilterBar>
								</form>
							</PopoverContent>
						</Popover>
						<Button
							icon={<RefreshCw aria-hidden="true" />}
							variant="outline"
							onClick={() => void model.load(search)}
							disabled={state.loading}
						>
							刷新
						</Button>
					</>
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
					<SectionRule variant="label" title="调用次数">
						<LayerCard>
							<LayerCard.Body>
								<Grid columns={1} gap="sm">
									<BarChart
										className="ops-plot"
										showAxes
										data={model.chart}
										series={[{ key: "calls", label: "调用次数" }]}
										ariaLabel="各密钥的每日调用次数"
										summary="每根柱代表一个密钥一天内的值，不跨密钥汇总。"
										dataAlternative={alternative}
									/>
								</Grid>
							</LayerCard.Body>
						</LayerCard>
					</SectionRule>
					<SectionRule variant="label" title="错误率">
						<LayerCard>
							<LayerCard.Body>
								<Grid columns={1} gap="sm">
									<BarChart
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
					</SectionRule>
				</Grid>
			) : null}
			<LayerCard id="usage-daily-table" padding="none">
				{state.loading && state.items.length === 0 ? (
					<LayerCard.Loading label="正在加载每日用量" />
				) : (
					<DataTable
						className="octo-table"
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
									className="octo-empty octo-empty--page"
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
	const [geometry, setGeometry] = useState({ top: 0, height: 480, row: 64 });
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
				meta="包含被拒绝的请求；不记录正文和凭据"
				actions={
					<>
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="outline" aria-label="审计筛选" title="审计筛选">
									<Filter aria-hidden="true" />
									筛选
									{Object.values(filters).filter(Boolean).length
										? `（${Object.values(filters).filter(Boolean).length}）`
										: ""}
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								style={{ width: "min(40rem, calc(100vw - 2rem))", maxWidth: "calc(100vw - 2rem)" }}
							>
								<form
									key={search}
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
									<FilterBar
										label="审计筛选"
										chips={
											auditFilterFields.some(([key]) => filters[key])
												? auditFilterFields
														.filter(([key]) => filters[key])
														.map(([key, label]) => (
															<FilterChip
																key={key}
																label={label}
																value={filters[key]}
																removeLabel={`移除${label}筛选`}
																onRemove={() => setParams(auditQuery({ ...filters, [key]: "" }))}
															/>
														))
												: undefined
										}
									>
										<Grid columns={1} gap="sm" className="ops-filter-fields">
											<Grid
												columns={2}
												gap="sm"
												className="ops-date-range"
												role="group"
												aria-label="日期范围"
												style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
											>
												<Field label="开始日期">
													<Input
														name="from"
														type="date"
														aria-label="开始日期"
														title="开始日期"
														defaultValue={filters.from.slice(0, 10)}
													/>
												</Field>
												<Field label="结束日期">
													<Input
														name="to"
														type="date"
														aria-label="结束日期"
														title="结束日期"
														defaultValue={filters.to.slice(0, 10)}
													/>
												</Field>
											</Grid>
											<Field label="状态码">
												<Input
													className="ops-filter-status"
													aria-label="状态码"
													title="状态码"
													name="status"
													type="number"
													min={100}
													max={599}
													step={1}
													defaultValue={filters.status}
												/>
											</Field>
											<Field label="调用者">
												<Input
													className="ops-filter-actor"
													name="actor"
													aria-label="调用者"
													title="调用者"
													defaultValue={filters.actor}
													autoComplete="off"
												/>
											</Field>
											<Field label="路由模板">
												<Input
													className="ops-filter-route"
													name="action"
													aria-label="路由模板"
													title="路由模板"
													defaultValue={filters.action}
													autoComplete="off"
												/>
											</Field>
											<fieldset className="ops-filter-actions" aria-label="筛选操作">
												<Button type="button" variant="ghost" onClick={() => setParams("")}>
													清除筛选
												</Button>
												<Button
													type="submit"
													icon={<Filter aria-hidden="true" />}
													variant="outline"
												>
													应用筛选
												</Button>
											</fieldset>
										</Grid>
									</FilterBar>
								</form>
							</PopoverContent>
						</Popover>
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
						className="octo-table ops-audit-table"
						aria-label="审计记录"
						aria-rowcount={state.items.length + 1}
					>
						<TableCaption>使用方向键或向下翻页键滚动，点击“加载更多”获取下一页。</TableCaption>
						<TableHeader>
							<TableRow>
								{["时间", "请求", "结果", "耗时", "调用者", "请求标识"].map((label) => (
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
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{window.before > 0 && (
								<TableRow aria-hidden="true">
									<TableCell colSpan={6} className="ops-spacer" style={{ height: window.before }} />
								</TableRow>
							)}
							{state.items.slice(window.start, window.end).map((row, index) => (
								<TableRow key={row.id} data-audit-row="" aria-rowindex={window.start + index + 2}>
									<TableCell className="ps-basalt-table-edge">
										<RecordTime value={row.at} />
									</TableCell>
									<TableCell>
										<Grid columns={1} gap="sm" className="ops-audit-detail">
											<TagBadge
												name={row.method}
												color={
													row.method === "GET"
														? "blue"
														: row.method === "DELETE"
															? "danger"
															: "amber"
												}
												size="sm"
											/>
											<code className="text-basalt-sm">{row.route}</code>
										</Grid>
									</TableCell>
									<TableCell>
										<Grid columns={1} gap="sm" className="ops-audit-detail">
											<TagBadge
												name={String(row.status)}
												color={
													row.status >= 500 ? "danger" : row.status >= 400 ? "warning" : "success"
												}
												size="sm"
											/>
											{row.error_code && (
												<span className="text-basalt-sm text-basalt-muted-foreground">
													{operationsError(row.error_code)}
												</span>
											)}
										</Grid>
									</TableCell>
									<TableCell textAlign="end">
										{formatNumber(row.duration_ms)} <span className="octo-muted">ms</span>
									</TableCell>
									<TableCell>
										<span className="octo-record-id" title={row.actor}>
											{row.actor}
										</span>
									</TableCell>
									<TableCell className="pe-basalt-table-edge">
										<span className="octo-record-id" title={row.request_id}>
											{row.request_id}
										</span>
									</TableCell>
								</TableRow>
							))}
							{window.after > 0 && (
								<TableRow aria-hidden="true">
									<TableCell colSpan={6} className="ops-spacer" style={{ height: window.after }} />
								</TableRow>
							)}
							{state.items.length === 0 && !state.loading && (
								<TableRow>
									<TableCell colSpan={6} className="ps-basalt-table-edge pe-basalt-table-edge">
										{state.error ? (
											"审计记录暂不可用，请重试查询。"
										) : state.loaded ? (
											<LayerCard.Empty
												className="octo-empty octo-empty--page"
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
		</Grid>
	);
}
