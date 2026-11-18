import {
	ANIMATION_PROPS,
	BAR_RADIUS,
	ChartFrame,
	cartesianAxisProps,
	chartTooltipProps,
	formatChartNumber,
	GRID_PROPS,
	getChartColor,
	RESPONSIVE_CONTAINER_PROPS,
} from "@nocoo/basalt/components/chart";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { x: string | number; [key: string]: string | number | null };

export function BarSeriesChart({
	data,
	series,
	ariaLabel,
	size = "h-basalt-36 w-basalt-56",
	summary,
	dataAlternative,
	showAxes = false,
	yDomain,
	valueFormatter = formatChartNumber,
}: {
	data: Point[];
	series: { key: string; label: string; color?: string }[];
	ariaLabel: string;
	size?: string;
	summary?: ReactNode;
	dataAlternative?: ReactNode;
	showAxes?: boolean;
	yDomain?: [number, number];
	valueFormatter?: (value: number) => string;
}) {
	return (
		<ChartFrame
			className="ring-1 ring-basalt-border/80 shadow-basalt-card"
			ariaLabel={ariaLabel}
			size={size}
			summary={summary}
			dataAlternative={dataAlternative}
		>
			<ResponsiveContainer {...RESPONSIVE_CONTAINER_PROPS}>
				<BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }} barCategoryGap={1}>
					{showAxes ? <CartesianGrid {...GRID_PROPS} /> : null}
					<XAxis dataKey="x" {...cartesianAxisProps(!showAxes)} minTickGap={24} />
					<YAxis
						{...cartesianAxisProps(!showAxes)}
						domain={yDomain ?? [0, "auto"]}
						allowDecimals={false}
						width={showAxes ? 34 : 0}
					/>
					<Tooltip {...chartTooltipProps({ cursor: "bar", formatter: valueFormatter })} />
					{series.map((item, index) => (
						<Bar
							key={item.key}
							dataKey={item.key}
							name={item.label}
							fill={item.color ?? getChartColor(index)}
							radius={BAR_RADIUS.vertical}
							{...ANIMATION_PROPS}
						/>
					))}
				</BarChart>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
