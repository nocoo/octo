import {
	ANIMATION_PROPS,
	BAR_RADIUS,
	cartesianAxisProps,
	chartTooltipProps,
	GRID_PROPS,
} from "@nocoo/basalt/charts/config";
import { ChartShell } from "@nocoo/basalt/charts/frame";
import { ChartLegend } from "@nocoo/basalt/charts/legend";
import { ChartTooltipRow } from "@nocoo/basalt/charts/tooltip";
import { Grid } from "@nocoo/basalt/components/grid";
import { Text } from "@nocoo/basalt/components/text";
import type { ReactNode } from "react";
import {
	Bar,
	CartesianGrid,
	Cell,
	ComposedChart,
	Line,
	LineChart,
	Pie,
	PieChart,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { formatNumber, formatPercent } from "../lib/format";
import {
	type DailyRow,
	type NamedValue,
	OP_BUCKETS,
	type OpBucket,
	type SeriesChart,
} from "../viewmodels/overview";

const token = (index: number) => `hsl(var(--basalt-chart-${index}))`;
const SERIES_COLORS = [1, 7, 5, 4, 3, 6, 2, 8, 17].map(token);
const SERIES_MUTED = "hsl(var(--basalt-muted-foreground))";
const SECONDARY_LINE = token(17);
const ERROR_LINE = "hsl(var(--basalt-destructive))";

export function seriesColor(colorIndex: number): string {
	if (colorIndex < 0) return SERIES_MUTED;
	return SERIES_COLORS[colorIndex % SERIES_COLORS.length] ?? token(1);
}

export const OP_COLORS: Record<OpBucket, string> = {
	created: token(5),
	updated: token(1),
	moved: token(3),
	restored: token(7),
	rolled_back: token(4),
	trashed: token(6),
	purged: token(2),
};

function dayLabel(value: string | number): string {
	return String(value).slice(5);
}

function ChartTip({ title, children }: { title: ReactNode; children: ReactNode }) {
	return (
		<Grid columns={1} className="octo-chart-tip">
			<Text as="strong" size="sm">
				{title}
			</Text>
			{children}
		</Grid>
	);
}

function activeBuckets(rows: DailyRow[]): readonly { key: OpBucket; label: string }[] {
	const active = OP_BUCKETS.filter((bucket) => rows.some((row) => row[bucket.key] > 0));
	return active.length > 0 ? active : OP_BUCKETS.slice(0, 1);
}

export function OperationTrendChart({ rows }: { rows: DailyRow[] }) {
	const buckets = activeBuckets(rows);
	const legend = [
		...buckets.map((bucket) => ({
			key: bucket.key,
			label: bucket.label,
			color: OP_COLORS[bucket.key],
		})),
		{ key: "net", label: "净增 · 右轴", color: SECONDARY_LINE },
	];
	return (
		<ChartShell
			ariaLabel="记忆操作趋势"
			size="octo-chart-plot w-full"
			legend={<ChartLegend items={legend} shape="bar" />}
			summary={
				<span className="sr-only">每日记忆操作按类型堆叠（左轴），净增记忆数为折线（右轴）。</span>
			}
		>
			<ComposedChart
				data={rows}
				margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
				barCategoryGap={1}
			>
				<CartesianGrid {...GRID_PROPS} />
				<XAxis dataKey="x" {...cartesianAxisProps()} tickFormatter={dayLabel} minTickGap={24} />
				<YAxis yAxisId="ops" {...cartesianAxisProps()} allowDecimals={false} width={30} />
				<YAxis
					yAxisId="net"
					orientation="right"
					{...cartesianAxisProps()}
					allowDecimals={false}
					width={34}
				/>
				<Tooltip
					{...chartTooltipProps({ cursor: "bar" })}
					content={({ active, payload }) => {
						const row = payload?.[0]?.payload as DailyRow | undefined;
						if (!active || !row) return null;
						return (
							<ChartTip title={row.x}>
								{buckets.map((bucket) => (
									<ChartTooltipRow
										key={bucket.key}
										label={bucket.label}
										color={OP_COLORS[bucket.key]}
										value={row[bucket.key]}
									/>
								))}
								<ChartTooltipRow label="净增" color={SECONDARY_LINE} value={row.net} />
								<ChartTooltipRow
									label="接口调用"
									hideIndicator
									value={`${formatNumber(row.calls)} · 错误 ${formatNumber(row.errors)}`}
								/>
							</ChartTip>
						);
					}}
				/>
				{buckets.map((bucket, index) => (
					<Bar
						key={bucket.key}
						yAxisId="ops"
						dataKey={bucket.key}
						name={bucket.label}
						stackId="ops"
						fill={OP_COLORS[bucket.key]}
						{...(index === buckets.length - 1 ? { radius: BAR_RADIUS.vertical } : {})}
						{...ANIMATION_PROPS}
					/>
				))}
				<Line
					yAxisId="net"
					dataKey="net"
					name="净增"
					stroke={SECONDARY_LINE}
					strokeWidth={2}
					dot={false}
					type="monotone"
					{...ANIMATION_PROPS}
				/>
			</ComposedChart>
		</ChartShell>
	);
}

export function SpaceTrendChart({ data }: { data: SeriesChart }) {
	const series = data.series.map((item) => ({
		key: item.key,
		label: item.label,
		color: seriesColor(item.colorIndex),
	}));
	return (
		<ChartShell
			ariaLabel="各空间记忆操作趋势"
			size="octo-chart-plot w-full"
			legend={<ChartLegend items={series} shape="line" />}
			summary={
				<span className="sr-only">按日比较操作量最高的空间，折线为当天全部记忆操作数。</span>
			}
		>
			<LineChart data={data.rows} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
				<CartesianGrid {...GRID_PROPS} />
				<XAxis dataKey="x" {...cartesianAxisProps()} tickFormatter={dayLabel} minTickGap={24} />
				<YAxis {...cartesianAxisProps()} allowDecimals={false} width={30} />
				<Tooltip
					{...chartTooltipProps({ cursor: "line" })}
					content={({ active, payload, label }) => {
						if (!active || !payload?.length) return null;
						return (
							<ChartTip title={String(label)}>
								{series.map((item) => (
									<ChartTooltipRow
										key={item.key}
										label={item.label}
										color={item.color}
										value={Number(
											(payload.find((entry) => entry.dataKey === item.key)?.value as number) ?? 0,
										)}
									/>
								))}
							</ChartTip>
						);
					}}
				/>
				{series.map((item) => (
					<Line
						key={item.key}
						dataKey={item.key}
						name={item.label}
						stroke={item.color}
						strokeWidth={2}
						dot={false}
						type="monotone"
						{...ANIMATION_PROPS}
					/>
				))}
			</LineChart>
		</ChartShell>
	);
}

function mergedRows(data: SeriesChart, rows: DailyRow[]): Record<string, string | number>[] {
	const calls = new Map(rows.map((row) => [row.x, row.calls]));
	return data.rows.map((row) => ({
		...row,
		calls: calls.get(String(row.x)) ?? 0,
	}));
}

export function BotOperationChart({ data, rows }: { data: SeriesChart; rows: DailyRow[] }) {
	const series = data.series.map((item) => ({
		key: item.key,
		label: item.label,
		color: seriesColor(item.colorIndex),
	}));
	const legend = [...series, { key: "calls", label: "接口调用 · 右轴", color: SECONDARY_LINE }];
	return (
		<ChartShell
			ariaLabel="Bot 记忆操作趋势"
			size="octo-chart-plot w-full"
			legend={<ChartLegend items={legend} shape="bar" />}
			summary={
				<span className="sr-only">
					每日记忆操作按密钥堆叠（左轴），当天接口调用数为折线（右轴）。
				</span>
			}
		>
			<ComposedChart
				data={mergedRows(data, rows)}
				margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
				barCategoryGap={1}
			>
				<CartesianGrid {...GRID_PROPS} />
				<XAxis dataKey="x" {...cartesianAxisProps()} tickFormatter={dayLabel} minTickGap={24} />
				<YAxis yAxisId="ops" {...cartesianAxisProps()} allowDecimals={false} width={30} />
				<YAxis
					yAxisId="calls"
					orientation="right"
					{...cartesianAxisProps()}
					allowDecimals={false}
					width={34}
				/>
				<Tooltip
					{...chartTooltipProps({ cursor: "bar" })}
					content={({ active, payload }) => {
						const row = payload?.[0]?.payload as Record<string, number> | undefined;
						if (!active || !row) return null;
						return (
							<ChartTip title={String(row.x)}>
								{series.map((item) => (
									<ChartTooltipRow
										key={item.key}
										label={item.label}
										color={item.color}
										value={Number(row[item.key] ?? 0)}
									/>
								))}
								<ChartTooltipRow
									label="接口调用"
									color={SECONDARY_LINE}
									value={Number(row.calls ?? 0)}
								/>
							</ChartTip>
						);
					}}
				/>
				{series.map((item, index) => (
					<Bar
						key={item.key}
						yAxisId="ops"
						dataKey={item.key}
						name={item.label}
						stackId="ops"
						fill={item.color}
						{...(index === series.length - 1 ? { radius: BAR_RADIUS.vertical } : {})}
						{...ANIMATION_PROPS}
					/>
				))}
				<Line
					yAxisId="calls"
					dataKey="calls"
					name="接口调用"
					stroke={SECONDARY_LINE}
					strokeWidth={2}
					dot={false}
					type="monotone"
					{...ANIMATION_PROPS}
				/>
			</ComposedChart>
		</ChartShell>
	);
}

export function BotCallChart({ data, rows }: { data: SeriesChart; rows: DailyRow[] }) {
	const series = data.series.map((item) => ({
		key: item.key,
		label: item.label,
		color: seriesColor(item.colorIndex),
	}));
	const rate = new Map(rows.map((row) => [row.x, row.errorRate]));
	const merged = data.rows.map((row) => {
		const value = rate.get(String(row.x));
		return { ...row, errorRate: value === null || value === undefined ? null : value * 100 };
	});
	const legend = [...series, { key: "errorRate", label: "错误率 · 右轴", color: ERROR_LINE }];
	return (
		<ChartShell
			ariaLabel="Bot 调用与错误率"
			size="octo-chart-plot w-full"
			legend={<ChartLegend items={legend} shape="line" />}
			summary={
				<span className="sr-only">每日接口调用按密钥堆叠（左轴），当天错误率为折线（右轴）。</span>
			}
		>
			<ComposedChart
				data={merged}
				margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
				barCategoryGap={1}
			>
				<CartesianGrid {...GRID_PROPS} />
				<XAxis dataKey="x" {...cartesianAxisProps()} tickFormatter={dayLabel} minTickGap={24} />
				<YAxis yAxisId="calls" {...cartesianAxisProps()} allowDecimals={false} width={30} />
				<YAxis
					yAxisId="rate"
					orientation="right"
					{...cartesianAxisProps()}
					width={38}
					tickFormatter={(value: number) => `${Math.round(value)}%`}
				/>
				<Tooltip
					{...chartTooltipProps({ cursor: "bar" })}
					content={({ active, payload }) => {
						const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
						if (!active || !row) return null;
						return (
							<ChartTip title={String(row.x)}>
								{series.map((item) => (
									<ChartTooltipRow
										key={item.key}
										label={item.label}
										color={item.color}
										value={Number(row[item.key] ?? 0)}
									/>
								))}
								<ChartTooltipRow
									label="错误率"
									color={ERROR_LINE}
									formatter={(value) => formatPercent(value / 100)}
									value={row.errorRate ?? null}
								/>
							</ChartTip>
						);
					}}
				/>
				{series.map((item, index) => (
					<Bar
						key={item.key}
						yAxisId="calls"
						dataKey={item.key}
						name={item.label}
						stackId="calls"
						fill={item.color}
						{...(index === series.length - 1 ? { radius: BAR_RADIUS.vertical } : {})}
						{...ANIMATION_PROPS}
					/>
				))}
				<Line
					yAxisId="rate"
					dataKey="errorRate"
					name="错误率"
					stroke={ERROR_LINE}
					strokeWidth={2}
					dot={false}
					connectNulls={false}
					type="monotone"
					{...ANIMATION_PROPS}
				/>
			</ComposedChart>
		</ChartShell>
	);
}

export function OverviewDonut({
	data,
	ariaLabel,
	summary,
	colorOf = (item) =>
		item.key === "other"
			? SERIES_MUTED
			: seriesColor(data.findIndex((entry) => entry.key === item.key)),
}: {
	data: NamedValue[];
	ariaLabel: string;
	summary: ReactNode;
	colorOf?: (item: NamedValue) => string;
}) {
	const total = data.reduce((sum, item) => sum + item.value, 0);
	return (
		<Grid
			columns={1}
			className="octo-donut"
			style={{ gridTemplateColumns: "var(--octo-grid-columns)" }}
		>
			<ChartShell ariaLabel={ariaLabel} size="octo-chart-donut w-full" summary={summary}>
				<PieChart>
					<Pie
						data={data.map((item) => ({ name: item.name, value: item.value }))}
						dataKey="value"
						nameKey="name"
						innerRadius="58%"
						outerRadius="90%"
						paddingAngle={0.6}
						stroke="none"
						{...ANIMATION_PROPS}
					>
						{data.map((item) => (
							<Cell key={item.key} fill={colorOf(item)} />
						))}
					</Pie>
					<Tooltip
						{...chartTooltipProps({ cursor: false, formatter: formatNumber })}
						content={({ active, payload }) => {
							const item = payload?.[0];
							if (!active || !item) return null;
							const value = Number(item.value ?? 0);
							return (
								<ChartTip title={String(item.name)}>
									<ChartTooltipRow label="数量" value={value} />
									<ChartTooltipRow
										label="占比"
										value={formatPercent(total > 0 ? value / total : null)}
									/>
								</ChartTip>
							);
						}}
					/>
				</PieChart>
			</ChartShell>
			<dl className="octo-donut-legend">
				{data.map((item) => (
					<Grid
						key={item.key}
						columns={2}
						className="octo-donut-row"
						style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
					>
						<dt title={item.name}>
							<span
								className="octo-donut-dot"
								style={{ background: colorOf(item) }}
								aria-hidden="true"
							/>
							<Text as="span" size="sm" truncate>
								{item.name}
							</Text>
						</dt>
						<dd>
							{formatNumber(item.value)}
							<small>{formatPercent(total > 0 ? item.value / total : null)}</small>
						</dd>
					</Grid>
				))}
			</dl>
		</Grid>
	);
}

export function opColorOf(item: NamedValue): string {
	return item.key in OP_COLORS ? OP_COLORS[item.key as OpBucket] : SERIES_MUTED;
}
