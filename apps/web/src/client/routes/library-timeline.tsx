import { LayerCard, Link } from "@nocoo/basalt";
import { Checkbox } from "@nocoo/basalt/components/checkbox";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { RecordTime, SpaceLink } from "../components/record-display";
import type { TimelineGroup, TimelineOptions } from "../viewmodels/library-visualizations";
import "./library-timeline.css";

type TimelineMemory = TimelineGroup["items"][number];
const columns: DataTableColumn<TimelineMemory>[] = [
	{
		id: "time",
		header: "时间（UTC）",
		width: "16ch",
		accessor: (item) => <RecordTime value={new Date(item.timestamp).toISOString()} utc />,
		sortValue: (item) => item.timestamp,
	},
	{
		id: "memory",
		header: "记忆",
		width: "24ch",
		wrap: true,
		accessor: (item) => (
			<Link
				href={`/memories/${encodeURIComponent(item.id)}`}
				className="octo-record-title"
				title={item.title}
			>
				{item.title}
			</Link>
		),
		sortValue: (item) => item.title,
	},
	{
		id: "space",
		header: "空间",
		width: "24ch",
		accessor: (item) => <SpaceLink space={item.space} />,
		sortValue: (item) => item.space,
	},
];

export function TimelineRecords({
	groups,
	zoom,
	table,
	selected,
	onSelected,
}: {
	groups: TimelineGroup[];
	zoom: TimelineOptions["zoom"];
	table: boolean;
	selected: string[];
	onSelected: (ids: string[]) => void;
}) {
	return (
		<Grid columns={1} gap="lg">
			{groups.map((group) => (
				<Grid
					key={group.label}
					className="octo-timeline-group"
					style={{ gridTemplateColumns: "var(--octo-timeline-columns)" }}
				>
					<SectionRule variant="heading" title={group.label} className="octo-timeline-date">
						<p className="octo-muted">{group.items.length} 条记忆 · UTC</p>
					</SectionRule>
					<LayerCard padding="none">
						{table ? (
							<DataTable
								className="octo-table"
								aria-label={`${group.label} 的时间线数据`}
								data={group.items}
								columns={columns}
								getRowId={(item) => item.id}
								selected={selected.filter((id) => group.items.some((item) => item.id === id))}
								onSelectedChange={(ids) =>
									onSelected([
										...selected.filter((id) => !group.items.some((item) => item.id === id)),
										...ids,
									])
								}
								pageSize={20}
								edge="attached"
							/>
						) : (
							<ol aria-label={`${group.label} 的记忆`} className="octo-timeline-records">
								{group.items.map((item) => {
									const timestamp = new Date(item.timestamp).toISOString();
									return (
										<li
											key={item.id}
											className="octo-timeline-record"
											data-selected={selected.includes(item.id)}
										>
											<Checkbox
												aria-label={`选择 ${item.title}`}
												checked={selected.includes(item.id)}
												onCheckedChange={(checked) =>
													onSelected([
														...selected.filter((id) => id !== item.id),
														...(checked ? [item.id] : []),
													])
												}
											/>
											<time dateTime={timestamp} title={timestamp} className="octo-timeline-time">
												{`${zoom === "month" ? `${timestamp.slice(5, 10)} ` : ""}${timestamp.slice(11, 19)} UTC`}
											</time>
											<Grid
												gap="sm"
												className="octo-timeline-content"
												style={{ gridTemplateColumns: "var(--octo-timeline-content-columns)" }}
											>
												<Link
													href={`/memories/${encodeURIComponent(item.id)}`}
													className="octo-timeline-title"
												>
													{item.title}
												</Link>
												<SpaceLink space={item.space} />
											</Grid>
										</li>
									);
								})}
							</ol>
						)}
					</LayerCard>
				</Grid>
			))}
		</Grid>
	);
}
