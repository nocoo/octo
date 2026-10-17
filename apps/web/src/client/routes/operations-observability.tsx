import { Badge, Button, Field, Input, LayerCard, StatStrip, toast } from "@nocoo/basalt";
import { LineChart } from "@nocoo/basalt/charts/line";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
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
		{ id: "day", header: "Day", accessor: (row) => row.day },
		{ id: "key", header: "Key", accessor: (row) => row.key_id },
		{
			id: "calls",
			header: "Calls",
			textAlign: "end",
			accessor: (row) => row.calls.toLocaleString(),
		},
		{
			id: "errors",
			header: "Errors",
			textAlign: "end",
			accessor: (row) => row.errors.toLocaleString(),
		},
		{
			id: "rate",
			header: "Error rate",
			textAlign: "end",
			accessor: (row) => `${row.error_rate.toFixed(2)}%`,
		},
		{
			id: "p50",
			header: "P50",
			textAlign: "end",
			accessor: (row) => (row.p50_ms === null ? "Unavailable" : `${row.p50_ms} ms`),
		},
		{
			id: "p95",
			header: "P95",
			textAlign: "end",
			accessor: (row) => (row.p95_ms === null ? "Unavailable" : `${row.p95_ms} ms`),
		},
	];
	const alternative = (
		<p className="ops-muted">
			Exact values are available in the <a href="#usage-daily-table">daily usage table</a>.
		</p>
	);
	return (
		<div className="ops-page">
			<PageHeader
				title="Usage and health"
				description="Calls, errors and latency by key and day. No rate limiting is applied."
				actions={
					<Button
						variant="outline"
						onClick={() => void model.load(search)}
						disabled={state.loading}
					>
						Refresh
					</Button>
				}
				filters={
					<form
						key={search}
						className="ops-filters"
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
						<Field label="Key ID">
							<Input name="key_id" defaultValue={filters.key_id} autoComplete="off" />
						</Field>
						<Field label="From">
							<Input type="date" name="from" defaultValue={filters.from} />
						</Field>
						<Field label="To">
							<Input type="date" name="to" defaultValue={filters.to} />
						</Field>
						<Button type="submit" variant="outline">
							Apply filters
						</Button>
						<Button type="button" variant="ghost" onClick={() => setParams("")}>
							Clear filters
						</Button>
					</form>
				}
			/>
			{state.error && (
				<p role="alert">
					{state.error}{" "}
					<Button size="sm" variant="ghost" onClick={() => void model.load(search)}>
						Retry
					</Button>
				</p>
			)}
			<LayerCard>
				<LayerCard.Header>Infrastructure</LayerCard.Header>
				<LayerCard.Body>
					<StatStrip
						loading={state.loading}
						items={[
							{
								label: "D1 bytes",
								value: state.loaded ? state.health.d1_bytes.toLocaleString() : "Unavailable",
							},
							{
								label: "Pending vector sync",
								value: state.loaded ? state.health.vector_backlog.toLocaleString() : "Unavailable",
							},
							{
								label: "Last cron run",
								value: !state.loaded
									? "Unavailable"
									: state.health.cron_last_run_at === null
										? "Never recorded"
										: new Date(state.health.cron_last_run_at).toLocaleString(),
							},
						]}
					/>
				</LayerCard.Body>
			</LayerCard>
			{state.daily.length > 0 ? (
				<div className="ops-chart-grid">
					<LayerCard>
						<LayerCard.Header>Calls</LayerCard.Header>
						<LayerCard.Body>
							<div className="ops-chart">
								<LineChart
									className="ops-plot"
									showAxes
									data={model.chart}
									series={[{ key: "calls", label: "Calls" }]}
									ariaLabel="Calls by key and day"
									summary="Each point represents one key on one day; values are not aggregated across keys."
									dataAlternative={alternative}
								/>
							</div>
						</LayerCard.Body>
					</LayerCard>
					<LayerCard>
						<LayerCard.Header>Error rate</LayerCard.Header>
						<LayerCard.Body>
							<div className="ops-chart">
								<LineChart
									className="ops-plot"
									showAxes
									yDomain={[0, 100]}
									data={model.chart}
									series={[{ key: "error_rate", label: "Error rate (%)" }]}
									ariaLabel="Error rate by key and day"
									valueFormatter={(value) => `${value.toFixed(1)}%`}
									summary="Percentage of calls returning errors for each key and day."
									dataAlternative={alternative}
								/>
							</div>
						</LayerCard.Body>
					</LayerCard>
					<LayerCard>
						<LayerCard.Header>Latency</LayerCard.Header>
						<LayerCard.Body>
							<div className="ops-chart">
								<LineChart
									className="ops-plot"
									showAxes
									data={model.chart}
									series={[
										{ key: "p50_ms", label: "P50 (ms)" },
										{ key: "p95_ms", label: "P95 (ms)" },
									]}
									showLegend
									ariaLabel="P50 and P95 latency by key and day"
									valueFormatter={(value) => `${value} ms`}
									summary="Server-computed percentiles; missing measurements remain unavailable, not zero."
									dataAlternative={alternative}
								/>
							</div>
						</LayerCard.Body>
					</LayerCard>
				</div>
			) : (
				!state.loading && (
					<LayerCard>
						<LayerCard.Empty
							title="No usage in this range"
							description="Adjust filters or make an API request with an agent key."
						/>
					</LayerCard>
				)
			)}
			<div id="usage-daily-table">
				<LayerCard>
					<LayerCard.Header>Daily usage / chart data</LayerCard.Header>
					<DataTable
						aria-label="Daily usage table"
						data={model.rows}
						columns={columns}
						getRowId={(row) => `${row.key_id}/${row.day}`}
						edge="attached"
						loading={state.loading && state.daily.length === 0}
						empty="No daily usage records."
					/>
				</LayerCard>
			</div>
		</div>
	);
}

export function AuditPage() {
	const [model] = useState(() => new AuditModel());
	const state = useModel(model);
	const [params, setParams] = useSearchParams();
	const search = params.toString();
	const filters = parseAuditFilters(search);
	const viewport = useRef<HTMLElement>(null);
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
		<div className="ops-page">
			<PageHeader
				title="Audit log"
				description="Every call, including denied requests. Request bodies and credentials are never recorded."
				actions={
					<>
						<Button
							variant="outline"
							onClick={() => void model.load(search)}
							disabled={state.loading}
						>
							Refresh
						</Button>
						<Button
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
								toast.success("Audit CSV exported.");
							}}
						>
							Export CSV
						</Button>
					</>
				}
				filters={
					<form
						key={search}
						className="ops-filters"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							setParams(
								auditQuery({
									actor: String(data.get("actor") ?? "").trim(),
									route: String(data.get("route") ?? "").trim(),
									status: String(data.get("status") ?? ""),
									from: String(data.get("from") ?? ""),
									to: String(data.get("to") ?? ""),
								}),
							);
						}}
					>
						<Field label="Actor">
							<Input name="actor" defaultValue={filters.actor} autoComplete="off" />
						</Field>
						<Field label="Route">
							<Input name="route" defaultValue={filters.route} autoComplete="off" />
						</Field>
						<Field label="Status code">
							<Input
								name="status"
								type="number"
								min={100}
								max={599}
								step={1}
								defaultValue={filters.status}
							/>
						</Field>
						<Field label="From">
							<Input name="from" type="date" defaultValue={filters.from.slice(0, 10)} />
						</Field>
						<Field label="To">
							<Input name="to" type="date" defaultValue={filters.to.slice(0, 10)} />
						</Field>
						<Button type="submit" variant="outline">
							Apply filters
						</Button>
						<Button type="button" variant="ghost" onClick={() => setParams("")}>
							Clear filters
						</Button>
					</form>
				}
			/>
			{state.error && (
				<p role="alert">
					{state.error}{" "}
					<Button variant="ghost" size="sm" onClick={() => void model.load(search)}>
						Retry
					</Button>
				</p>
			)}
			{state.loading && <p role="status">Refreshing audit log...</p>}
			<LayerCard>
				<LayerCard.Header>
					{state.items.length.toLocaleString()} loaded records{" "}
					<span className="ops-muted">/ virtualized rows</span>
				</LayerCard.Header>
				<section
					ref={viewport}
					className="ops-audit-scroll"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the audit viewport.
					tabIndex={0}
					aria-label="Scrollable audit records"
					onScroll={(event) => {
						const top = event.currentTarget.scrollTop;
						setGeometry((current) => ({ ...current, top }));
					}}
				>
					<Table
						ref={table}
						className="ops-audit-table"
						aria-label="Audit records"
						aria-rowcount={state.items.length + 1}
					>
						<TableCaption>
							Times are local. Use arrow keys or Page Down in this region to scroll; load more to
							retrieve the next server page.
						</TableCaption>
						<TableHeader>
							<TableRow>
								{["Time", "Actor", "Method", "Route", "Status", "Duration", "Request ID"].map(
									(label) => (
										<TableHead
											key={label}
											textAlign={label === "Duration" ? "end" : "start"}
											className={
												label === "Time"
													? "ps-basalt-table-edge"
													: label === "Request ID"
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
									<TableCell colSpan={7} className="ops-spacer" style={{ height: window.before }} />
								</TableRow>
							)}
							{state.items.slice(window.start, window.end).map((row, index) => (
								<TableRow key={row.id} data-audit-row="" aria-rowindex={window.start + index + 2}>
									<TableCell className="ps-basalt-table-edge">
										{new Date(row.at).toLocaleString()}
									</TableCell>
									<TableCell>{row.actor}</TableCell>
									<TableCell>{row.method}</TableCell>
									<TableCell>{row.route}</TableCell>
									<TableCell>
										<Badge variant={row.status >= 400 ? "secondary" : "success"}>
											{row.status}
										</Badge>
										{row.error_code && <span className="ops-muted"> {row.error_code}</span>}
									</TableCell>
									<TableCell textAlign="end">{row.duration_ms} ms</TableCell>
									<TableCell className="pe-basalt-table-edge">{row.request_id}</TableCell>
								</TableRow>
							))}
							{window.after > 0 && (
								<TableRow aria-hidden="true">
									<TableCell colSpan={7} className="ops-spacer" style={{ height: window.after }} />
								</TableRow>
							)}
							{state.items.length === 0 && !state.loading && (
								<TableRow>
									<TableCell colSpan={7} className="ps-basalt-table-edge pe-basalt-table-edge">
										No audit records match these filters.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</section>
				<LayerCard.Footer>
					<Button
						variant="outline"
						disabled={!state.nextCursor || state.loading}
						loading={state.loadingMore}
						onClick={() => void model.loadMore()}
					>
						Load more
					</Button>
					<span className="ops-muted">
						{state.nextCursor ? "More records available" : "End of loaded query"}
					</span>
				</LayerCard.Footer>
			</LayerCard>
		</div>
	);
}
