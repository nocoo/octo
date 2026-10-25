import { Link } from "@nocoo/basalt";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import { formatNumber } from "../lib/format";
import type { GraphKind, GraphNode, LibraryGraph } from "../viewmodels/library-visualizations";

const kindLabel: Record<GraphKind, string> = { tag: "标签", memory: "记忆", cluster: "聚合节点" };
const kindColor: Record<GraphKind, "blue" | "teal" | "slate"> = {
	tag: "blue",
	memory: "teal",
	cluster: "slate",
};

export function GraphTables({
	graph,
	selected,
	onSelected,
}: {
	graph: LibraryGraph;
	selected: string[];
	onSelected: (ids: string[]) => void;
}) {
	const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
	const columns: DataTableColumn<GraphNode>[] = [
		{
			id: "label",
			header: "节点",
			width: "24ch",
			accessor: (node) =>
				node.href ? (
					<Link href={node.href} className="octo-record-title" title={node.label}>
						{node.kind === "tag" ? <TagBadge name={node.label} size="sm" /> : node.label}
					</Link>
				) : (
					node.label
				),
			sortValue: (node) => node.label,
			wrap: true,
		},
		{
			id: "kind",
			header: "类型",
			width: "12ch",
			accessor: (node) => (
				<TagBadge name={kindLabel[node.kind]} color={kindColor[node.kind]} size="sm" />
			),
			sortValue: (node) => node.kind,
		},
		{
			id: "count",
			header: "数量",
			width: "10ch",
			accessor: (node) => formatNumber(node.count),
			sortValue: (node) => node.count,
			textAlign: "end",
			cellClassName: "tabular-nums",
		},
	];
	return (
		<Grid columns={1} gap="lg" className="octo-graph-tables">
			<DataTable
				className="octo-table"
				aria-label="图谱节点"
				data={graph.nodes}
				columns={columns}
				getRowId={(node) => node.id}
				selected={selected}
				onSelectedChange={onSelected}
				pageSize={10}
			/>
			<DataTable
				className="octo-table"
				aria-label="图谱关系"
				data={graph.links}
				columns={[
					{
						id: "source",
						header: "起点",
						width: "24ch",
						accessor: (link) => (
							<span className="octo-record-title" title={labels.get(link.source)}>
								{labels.get(link.source)}
							</span>
						),
						sortValue: (link) => labels.get(link.source) ?? link.source,
						wrap: true,
					},
					{
						id: "target",
						header: "终点",
						width: "24ch",
						accessor: (link) => (
							<span className="octo-record-title" title={labels.get(link.target)}>
								{labels.get(link.target)}
							</span>
						),
						sortValue: (link) => labels.get(link.target) ?? link.target,
						wrap: true,
					},
					{
						id: "value",
						header: "关联强度",
						width: "12ch",
						accessor: (link) => formatNumber(link.value),
						sortValue: (link) => link.value,
						textAlign: "end",
					},
				]}
				getRowId={(link) => JSON.stringify([link.source, link.target])}
				pageSize={10}
			/>
		</Grid>
	);
}
