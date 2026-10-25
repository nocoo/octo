import { Badge, Button, Input, LayerCard, Link } from "@nocoo/basalt";
import { DescriptionList } from "@nocoo/basalt/components/description-list";
import { Grid } from "@nocoo/basalt/components/grid";
import { ScrollArea } from "@nocoo/basalt/components/scroll-area";
import { Separator } from "@nocoo/basalt/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nocoo/basalt/components/sheet";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import { ToggleGroup, ToggleGroupItem } from "@nocoo/basalt/components/toggle-group";
import { Toolbar } from "@nocoo/basalt/components/toolbar";
import { ListTree, Maximize2, Minus, Pause, Play, Plus, Table2, Tags, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useSearchParams } from "react-router";
import { RecordTime, SpaceLink } from "../components/record-display";
import { formatNumber } from "../lib/format";
import {
	filterGraphNodes,
	type GraphKind,
	type GraphNode,
	type GraphRankedNode,
	graphDegrees,
	graphFocus,
	graphMainComponent,
	graphNeighbors,
	type LibraryGraph,
	rankGraphNodes,
	selectedGraphNode,
	updateLibraryUrl,
} from "../viewmodels/library-visualizations";
import { GraphTables } from "./library-graph-tables";
import "./library-graph.css";

interface Palette {
	background: string;
	dark: boolean;
	tag: string;
	memory: string;
	cluster: string;
	link: string;
	text: string;
	card: string;
	primary: string;
	font: string;
}

const emptyPalette: Palette = {
	background: "",
	dark: true,
	tag: "",
	memory: "",
	cluster: "",
	link: "",
	text: "",
	card: "",
	primary: "",
	font: "",
};

const kindLabel: Record<GraphKind, string> = { tag: "标签", memory: "记忆", cluster: "聚合节点" };
const kindColor: Record<GraphKind, "blue" | "teal" | "slate"> = {
	tag: "blue",
	memory: "teal",
	cluster: "slate",
};
const compactQuery = "(max-width: 1023px)";
type VisualNode = GraphNode & { x?: number; y?: number };
const directoryLimit = 120;

function endpointId(endpoint: unknown): string {
	return typeof endpoint === "string" ? endpoint : (endpoint as GraphNode).id;
}

function kindFilter(params: URLSearchParams): GraphKind | "all" {
	const value = params.get("kind");
	return value === "tag" || value === "memory" || value === "cluster" ? value : "all";
}

function GraphDirectory({
	visible,
	total,
	query,
	kind,
	selectedId,
	onQuery,
	onKind,
	onSelect,
}: {
	visible: GraphRankedNode[];
	total: number;
	query: string;
	kind: GraphKind | "all";
	selectedId: string | null;
	onQuery: (value: string) => void;
	onKind: (value: GraphKind | "all") => void;
	onSelect: (id: string) => void;
}) {
	const listed = visible.slice(0, directoryLimit);
	return (
		<Grid columns={1} className="octo-graph-directory">
			<LayerCard.Header>
				<Grid columns={2} className="octo-graph-directory-head">
					<Grid columns={2} className="octo-graph-directory-title">
						<span>节点</span>
						<Badge variant="secondary">{formatNumber(visible.length)}</Badge>
					</Grid>
					<span className="text-basalt-sm text-basalt-muted-foreground">
						共 {formatNumber(total)}
					</span>
				</Grid>
			</LayerCard.Header>
			<LayerCard.Body className="octo-graph-directory-body">
				<Input
					aria-label="搜索节点"
					placeholder="搜索节点"
					value={query}
					onChange={(event) => onQuery(event.target.value)}
				/>
				<ToggleGroup
					type="single"
					aria-label="节点类型"
					value={kind}
					onValueChange={(next) => {
						if (next) onKind(next as GraphKind | "all");
					}}
				>
					<ToggleGroupItem value="all">全部</ToggleGroupItem>
					<ToggleGroupItem value="tag">标签</ToggleGroupItem>
					<ToggleGroupItem value="memory">记忆</ToggleGroupItem>
				</ToggleGroup>
				<ScrollArea className="octo-graph-list" aria-label="节点列表">
					<Grid columns={1} gap="sm">
						{listed.map((node) => (
							<Button
								key={node.id}
								variant="ghost"
								size="sm"
								className="octo-graph-row"
								data-selected={node.id === selectedId}
								aria-pressed={node.id === selectedId}
								onClick={() => onSelect(node.id)}
							>
								<span className="octo-graph-dot" data-kind={node.kind} aria-hidden="true" />
								<span className="octo-graph-row-label">{node.label}</span>
								<span className="octo-graph-row-count">{formatNumber(node.degree)}</span>
							</Button>
						))}
						{listed.length === 0 && (
							<p className="text-basalt-sm text-basalt-muted-foreground">没有匹配的节点。</p>
						)}
						{visible.length > listed.length && (
							<p className="text-basalt-sm text-basalt-muted-foreground">
								还有 {formatNumber(visible.length - listed.length)} 个节点未列出，使用搜索缩小范围。
							</p>
						)}
					</Grid>
				</ScrollArea>
			</LayerCard.Body>
		</Grid>
	);
}

function GraphInspector({
	selected,
	neighbors,
	degrees,
	onSelect,
	onClose,
}: {
	selected: GraphNode;
	neighbors: { node: GraphNode; value: number }[];
	degrees: Map<string, number>;
	onSelect: (id: string) => void;
	onClose: () => void;
}) {
	return (
		<Grid columns={1} className="octo-graph-inspector">
			<LayerCard.Header>
				<Grid columns={2} className="octo-graph-inspector-head">
					<TagBadge name={kindLabel[selected.kind]} color={kindColor[selected.kind]} size="sm" />
					<Button
						variant="ghost"
						size="icon"
						aria-label="关闭节点详情"
						onClick={onClose}
						className="octo-graph-inspector-close"
					>
						<X size={16} aria-hidden="true" />
					</Button>
				</Grid>
			</LayerCard.Header>
			<LayerCard.Body className="octo-graph-inspector-body">
				<ScrollArea className="octo-graph-inspector-scroll" aria-label="节点详情">
					<Grid columns={1} gap="md">
						<p className="octo-graph-inspector-title">{selected.label}</p>
						<DescriptionList columns={1}>
							<DescriptionList.Item term="类型">{kindLabel[selected.kind]}</DescriptionList.Item>
							<DescriptionList.Item term="关联">
								{formatNumber(degrees.get(selected.id) ?? 0)} 条
							</DescriptionList.Item>
							{selected.kind === "memory" && selected.space && (
								<DescriptionList.Item term="空间">
									<SpaceLink space={selected.space} />
								</DescriptionList.Item>
							)}
							{selected.kind === "tag" && (
								<DescriptionList.Item term="记忆数">
									{formatNumber(selected.count)}
								</DescriptionList.Item>
							)}
							{selected.kind === "memory" && selected.time && (
								<DescriptionList.Item term="时间">
									<RecordTime value={selected.time} utc />
								</DescriptionList.Item>
							)}
						</DescriptionList>
						{selected.kind === "memory" && selected.tags && selected.tags.length > 0 && (
							<Grid columns={1} gap="sm">
								<span className="text-basalt-sm text-basalt-muted-foreground">标签</span>
								<Grid columns={1} className="octo-graph-taglist">
									{selected.tags.map((tag) => (
										<span key={tag}>
											<TagBadge name={tag} size="sm" />
										</span>
									))}
								</Grid>
							</Grid>
						)}
						{selected.href ? (
							<Button asChild>
								<Link href={selected.href}>
									{selected.kind === "tag" ? "查看该标签的记忆" : "打开记忆"}
								</Link>
							</Button>
						) : (
							<p className="text-basalt-sm text-basalt-muted-foreground">
								聚合节点。提高节点上限或缩小筛选范围后可以打开单个节点。
							</p>
						)}
						<Separator />
						<Grid columns={1} gap="sm">
							<span className="text-basalt-sm text-basalt-muted-foreground">
								关联节点 · {formatNumber(neighbors.length)}
							</span>
							<Grid columns={1} gap="sm">
								{neighbors.slice(0, 12).map((neighbor) => (
									<Button
										key={neighbor.node.id}
										variant="ghost"
										size="sm"
										className="octo-graph-row"
										onClick={() => onSelect(neighbor.node.id)}
									>
										<span
											className="octo-graph-dot"
											data-kind={neighbor.node.kind}
											aria-hidden="true"
										/>
										<span className="octo-graph-row-label">{neighbor.node.label}</span>
										<span className="octo-graph-row-count">
											{formatNumber(degrees.get(neighbor.node.id) ?? 0)}
										</span>
									</Button>
								))}
								{neighbors.length > 12 && (
									<p className="text-basalt-sm text-basalt-muted-foreground">
										另有 {formatNumber(neighbors.length - 12)} 个关联节点。
									</p>
								)}
								{neighbors.length === 0 && (
									<p className="text-basalt-sm text-basalt-muted-foreground">没有关联节点。</p>
								)}
							</Grid>
						</Grid>
					</Grid>
				</ScrollArea>
			</LayerCard.Body>
		</Grid>
	);
}

export default function LibraryGraphCanvas({ graph }: { graph: LibraryGraph }) {
	const [params, setParams] = useSearchParams();
	const host = useRef<HTMLDivElement>(null);
	const force = useRef<ForceGraphMethods<GraphNode> | undefined>(undefined);
	const backdrop = useRef<{
		ctx: CanvasRenderingContext2D;
		key: string;
		fills: CanvasGradient[];
	} | null>(null);
	const fitted = useRef(false);
	const manual = useRef(false);
	const [box, setBox] = useState({ width: 0, height: 0 });
	const [palette, setPalette] = useState<Palette>(emptyPalette);
	const [reduced, setReduced] = useState(false);
	const [hovered, setHovered] = useState<string | null>(null);
	const [frozen, setFrozen] = useState(false);
	const [labels, setLabels] = useState(true);
	const [compact, setCompact] = useState(false);
	const [tableOpen, setTableOpen] = useState(false);
	const [directoryOpen, setDirectoryOpen] = useState(false);
	const [detailOpen, setDetailOpen] = useState(false);
	const selectedId = params.get("node");
	const query = params.get("find") ?? "";
	const kind = kindFilter(params);
	const ranked = useMemo(() => rankGraphNodes(graph), [graph]);
	const degrees = useMemo(() => graphDegrees(graph), [graph]);
	const visible = useMemo(() => filterGraphNodes(ranked, query, kind), [ranked, query, kind]);
	const selected = selectedGraphNode(graph, selectedId);
	const neighbors = useMemo(
		() => (selected ? graphNeighbors(graph, selected.id) : []),
		[graph, selected],
	);
	const focus = useMemo(() => graphFocus(graph, selectedId), [graph, selectedId]);
	const mainComponent = useMemo(() => graphMainComponent(graph), [graph]);
	const labelIds = useMemo(
		() =>
			new Set(
				ranked
					.filter((node) => node.kind === "tag")
					.slice(0, compact ? 6 : 14)
					.map((node) => node.id),
			),
		[compact, ranked],
	);
	const data = useMemo(
		() => ({
			nodes: graph.nodes.map((node) => ({ ...node })),
			links: graph.links.map((link) => ({ ...link })),
		}),
		[graph],
	);

	useEffect(() => {
		const element = host.current;
		if (!element) return;
		const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
		const readPalette = () => {
			const style = getComputedStyle(element);
			const token = (name: string) => style.getPropertyValue(`--basalt-${name}`).trim();
			setPalette({
				background: token("background"),
				dark: document.documentElement.classList.contains("dark"),
				tag: token("chart-green"),
				memory: token("chart-blue"),
				cluster: token("chart-pearl"),
				link: token("border"),
				text: token("foreground"),
				card: token("card"),
				primary: token("primary"),
				font: token("font-sans"),
			});
		};
		const motion = matchMedia("(prefers-reduced-motion: reduce)");
		const preference = () => setReduced(motion.matches);
		const narrow = matchMedia(compactQuery);
		const viewport = () => setCompact(narrow.matches);
		const resize = new ResizeObserver(measure);
		const theme = new MutationObserver(readPalette);
		resize.observe(element);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style", "data-mode"],
		});
		motion.addEventListener("change", preference);
		narrow.addEventListener("change", viewport);
		measure();
		readPalette();
		preference();
		viewport();
		return () => {
			resize.disconnect();
			theme.disconnect();
			motion.removeEventListener("change", preference);
			narrow.removeEventListener("change", viewport);
		};
	}, []);

	useEffect(() => {
		fitted.current = false;
		manual.current = false;
		const fg = force.current;
		if (!fg || !palette.tag) return;
		type Tuned = {
			strength?: (value: number) => unknown;
			distance?: (value: number) => unknown;
			distanceMax?: (value: number) => unknown;
		};
		const charge = -Math.min(120, 34 + graph.nodes.length * 0.35);
		const repel = fg.d3Force("charge") as Tuned | undefined;
		repel?.strength?.(charge);
		repel?.distanceMax?.(200);
		(fg.d3Force("link") as Tuned | undefined)?.distance?.(30);
		fg.d3ReheatSimulation();
	}, [graph, palette.tag]);

	useEffect(() => {
		const fg = force.current;
		if (!fg) return;
		if (frozen) fg.pauseAnimation();
		else fg.resumeAnimation();
	}, [frozen]);

	const setParam = useCallback(
		(key: string, value: string) => {
			setParams(updateLibraryUrl(params, key, value), { replace: true });
		},
		[params, setParams],
	);

	const selectNode = useCallback(
		(id: string) => {
			manual.current = true;
			setParam("node", id);
			const target = (data.nodes as VisualNode[]).find((node) => node.id === id);
			if (target && Number.isFinite(target.x) && Number.isFinite(target.y))
				force.current?.centerAt(target.x, target.y, reduced ? 0 : 500);
			if (compact) setDetailOpen(true);
		},
		[compact, data, reduced, setParam],
	);

	const clearSelection = useCallback(() => setParam("node", ""), [setParam]);

	const zoomBy = useCallback(
		(factor: number) => {
			const fg = force.current;
			if (!fg) return;
			fg.zoom(fg.zoom() * factor, reduced ? 0 : 200);
		},
		[reduced],
	);

	const paintNode = useCallback(
		(node: VisualNode, ctx: CanvasRenderingContext2D, scale: number) => {
			const x = node.x ?? 0;
			const y = node.y ?? 0;
			const active = !focus || focus.has(node.id);
			const selectedNode = node.id === selectedId;
			const hoveredNode = node.id === hovered;
			const color =
				node.kind === "tag"
					? palette.tag
					: node.kind === "memory"
						? palette.memory
						: palette.cluster;
			const radius =
				(node.kind === "tag" ? 2.2 + Math.sqrt(node.count) : node.kind === "cluster" ? 4.6 : 2.4) *
				(selectedNode ? 1.6 : 1);
			ctx.globalAlpha = active ? 1 : 0.14;
			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2);
			ctx.fillStyle = hoveredNode ? `hsl(${palette.text})` : `hsl(${color})`;
			ctx.fill();
			if (active && node.kind !== "memory") {
				ctx.globalAlpha = 0.3;
				ctx.beginPath();
				ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
				ctx.strokeStyle = `hsl(${color})`;
				ctx.lineWidth = 1 / scale;
				ctx.stroke();
			}
			if (selectedNode) {
				ctx.globalAlpha = 1;
				ctx.beginPath();
				ctx.arc(x, y, radius + 4.5, 0, Math.PI * 2);
				ctx.strokeStyle = `hsl(${palette.primary})`;
				ctx.lineWidth = 1.6 / scale;
				ctx.stroke();
			}
			const wantsLabel =
				(selectedNode || hoveredNode || (labels && labelIds.has(node.id))) &&
				(active || selectedNode);
			if (wantsLabel && palette.font) {
				const size = 11 / scale;
				const text = node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label;
				ctx.font = `500 ${size}px ${palette.font}`;
				ctx.textBaseline = "middle";
				const inset = 4 / scale;
				const width = ctx.measureText(text).width;
				const left = x + radius + 6 / scale;
				ctx.globalAlpha = active ? 0.86 : 0.18;
				ctx.fillStyle = `hsl(${palette.card} / 0.72)`;
				ctx.beginPath();
				ctx.roundRect(left, y - size * 0.78, width + inset * 2, size * 1.56, size * 0.5);
				ctx.fill();
				ctx.globalAlpha = active ? 1 : 0.2;
				ctx.fillStyle = `hsl(${palette.text})`;
				ctx.fillText(text, left + inset, y);
			}
			ctx.globalAlpha = 1;
		},
		[focus, hovered, labelIds, labels, palette, selectedId],
	);

	const fitView = useCallback(
		(duration = 400) => {
			const fg = force.current;
			if (!fg) return;
			const keep = mainComponent.size * 2 >= graph.nodes.length ? mainComponent : null;
			fg.zoomToFit(duration, 28, keep ? (node) => keep.has((node as GraphNode).id) : undefined);
			const shift = compact ? 0 : 120;
			if (shift === 0) return;
			const center = fg.centerAt();
			const scale = fg.zoom();
			if (Number.isFinite(center.x) && scale > 0) fg.centerAt(center.x - shift / scale, center.y);
		},
		[compact, graph.nodes.length, mainComponent],
	);

	const paintFrame = useCallback(
		(ctx: CanvasRenderingContext2D) => {
			const { width, height } = box;
			if (!width || !height || !palette.primary || !palette.background) return;
			const key = [
				width,
				height,
				palette.background,
				palette.primary,
				palette.tag,
				palette.dark,
			].join("|");
			let cached = backdrop.current;
			if (!cached || cached.ctx !== ctx || cached.key !== key) {
				const reach = Math.max(width, height);
				const strength = palette.dark ? 1 : 0.34;
				const halo = (cx: number, cy: number, radius: number, hue: string, alpha: number) => {
					const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
					gradient.addColorStop(0, `hsl(${hue} / ${alpha * strength})`);
					gradient.addColorStop(0.55, `hsl(${hue} / ${alpha * strength * 0.34})`);
					gradient.addColorStop(1, `hsl(${hue} / 0)`);
					return gradient;
				};
				const vignette = ctx.createRadialGradient(
					width * 0.5,
					height * 0.46,
					reach * 0.26,
					width * 0.5,
					height * 0.46,
					reach * 0.82,
				);
				vignette.addColorStop(0, `hsl(${palette.background} / 0)`);
				vignette.addColorStop(
					0.72,
					`hsl(${palette.background} / ${0.55 * (palette.dark ? 1 : 0.6)})`,
				);
				vignette.addColorStop(1, `hsl(${palette.background} / ${0.95 * (palette.dark ? 1 : 0.7)})`);
				const fills = [
					halo(width * 0.5, height * 0.44, reach * 0.58, palette.primary, 0.34),
					halo(width * 0.86, height * 0.14, reach * 0.42, palette.primary, 0.16),
					halo(width * 0.2, height * 0.84, reach * 0.46, palette.tag, 0.16),
					vignette,
				];
				cached = { ctx, key, fills };
				backdrop.current = cached;
			}
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.fillStyle = `hsl(${palette.background})`;
			ctx.fillRect(0, 0, width, height);
			for (const fill of cached.fills) {
				ctx.fillStyle = fill;
				ctx.fillRect(0, 0, width, height);
			}
			ctx.restore();
		},
		[box, palette],
	);

	const paintHitArea = useCallback(
		(node: VisualNode, color: string, ctx: CanvasRenderingContext2D) => {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(node.x ?? 0, node.y ?? 0, 7, 0, Math.PI * 2);
			ctx.fill();
		},
		[],
	);

	const linkAlpha = useCallback(
		(link: { source?: unknown; target?: unknown }) => {
			if (!focus) return 0.34;
			return focus.has(endpointId(link.source)) && focus.has(endpointId(link.target)) ? 0.55 : 0.05;
		},
		[focus],
	);

	return (
		<Grid columns={1} className="octo-graph-stage">
			<LayerCard
				ref={host}
				className="octo-graph-canvas"
				padding="none"
				role="img"
				aria-label={`力导向关系图，${graph.nodes.length} 个节点、${graph.links.length} 条关联。左侧节点列表提供相同的键盘浏览入口。`}
			>
				{box.width > 0 && box.height > 0 && palette.tag && (
					<ForceGraph2D<GraphNode>
						ref={force}
						width={box.width}
						height={box.height}
						graphData={data}
						backgroundColor="transparent"
						onRenderFramePre={paintFrame}
						nodeVal={(node) => Math.max(1, node.count)}
						nodeCanvasObject={paintNode}
						nodePointerAreaPaint={paintHitArea}
						linkColor={(link) => `hsl(${palette.link} / ${linkAlpha(link)})`}
						linkWidth={(link) => Math.min(2, 0.3 + Math.sqrt(link.value) * 0.5)}
						warmupTicks={reduced ? 400 : 120}
						cooldownTicks={reduced ? 0 : 220}
						enableNodeDrag={!reduced}
						onEngineStop={() => {
							if (manual.current || fitted.current) return;
							fitted.current = true;
							fitView(reduced ? 0 : 400);
						}}
						onNodeHover={(node) => setHovered(node?.id ?? null)}
						onNodeDrag={() => {
							manual.current = true;
						}}
						onNodeClick={(node) => selectNode(node.id)}
						onBackgroundClick={clearSelection}
					/>
				)}
			</LayerCard>
			<p className="sr-only" aria-live="polite">
				{selected ? `已选择${kindLabel[selected.kind]}：${selected.label}` : ""}
			</p>
			<Toolbar aria-label="关系图工具" className="octo-graph-tools">
				<Toolbar.Button
					aria-label="放大"
					onClick={() => {
						manual.current = true;
						zoomBy(1.4);
					}}
				>
					<Plus size={16} aria-hidden="true" />
				</Toolbar.Button>
				<Toolbar.Button
					aria-label="缩小"
					onClick={() => {
						manual.current = true;
						zoomBy(0.7);
					}}
				>
					<Minus size={16} aria-hidden="true" />
				</Toolbar.Button>
				<Toolbar.Button
					aria-label="适应画布"
					onClick={() => {
						manual.current = false;
						fitView(reduced ? 0 : 400);
					}}
				>
					<Maximize2 size={16} aria-hidden="true" />
				</Toolbar.Button>
				<Separator orientation="vertical" />
				<Toolbar.Button
					aria-label="显示节点名称"
					aria-pressed={labels}
					onClick={() => setLabels(!labels)}
				>
					<Tags size={16} aria-hidden="true" />
				</Toolbar.Button>
				<Toolbar.Button
					aria-label={frozen ? "继续布局计算" : "暂停布局计算"}
					aria-pressed={frozen}
					onClick={() => setFrozen(!frozen)}
				>
					{frozen ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
				</Toolbar.Button>
				<Toolbar.Button aria-label="节点列表" onClick={() => setDirectoryOpen(true)}>
					<ListTree size={16} aria-hidden="true" />
				</Toolbar.Button>
				<Toolbar.Button aria-label="图谱数据表" onClick={() => setTableOpen(true)}>
					<Table2 size={16} aria-hidden="true" />
				</Toolbar.Button>
			</Toolbar>
			<LayerCard className="octo-graph-panel octo-graph-panel--directory" padding="none">
				<GraphDirectory
					visible={visible}
					total={ranked.length}
					query={query}
					kind={kind}
					selectedId={selectedId}
					onQuery={(value) => setParam("find", value)}
					onKind={(value) => setParam("kind", value === "all" ? "" : value)}
					onSelect={selectNode}
				/>
			</LayerCard>
			{selected && (
				<LayerCard className="octo-graph-panel octo-graph-panel--inspector" padding="none">
					<GraphInspector
						selected={selected}
						neighbors={neighbors}
						degrees={degrees}
						onSelect={selectNode}
						onClose={clearSelection}
					/>
				</LayerCard>
			)}
			<LayerCard className="octo-graph-panel octo-graph-panel--legend" padding="sm">
				<Grid columns={1} gap="sm">
					<Grid columns={3} className="octo-graph-legend">
						<span className="octo-graph-legend-item">
							<span className="octo-graph-dot" data-kind="tag" aria-hidden="true" />
							标签
						</span>
						<span className="octo-graph-legend-item">
							<span className="octo-graph-dot" data-kind="memory" aria-hidden="true" />
							记忆
						</span>
						<span className="octo-graph-legend-item">
							<span className="octo-graph-dot" data-kind="cluster" aria-hidden="true" />
							聚合节点
						</span>
					</Grid>
					<p className="octo-graph-hint text-basalt-sm text-basalt-muted-foreground">
						{graph.clustered > 0
							? `已聚合 ${formatNumber(graph.clustered)} 个节点。拖动平移，滚轮缩放，点击节点查看关联。`
							: "拖动平移，滚轮缩放，点击节点查看关联。"}
					</p>
				</Grid>
			</LayerCard>
			<Sheet open={directoryOpen} onOpenChange={setDirectoryOpen}>
				<SheetContent side="left" className="octo-graph-sheet">
					<SheetHeader>
						<SheetTitle>节点列表</SheetTitle>
						<SheetDescription>搜索并按类型筛选节点，选择后回到画布定位。</SheetDescription>
					</SheetHeader>
					<GraphDirectory
						visible={visible}
						total={ranked.length}
						query={query}
						kind={kind}
						selectedId={selectedId}
						onQuery={(value) => setParam("find", value)}
						onKind={(value) => setParam("kind", value === "all" ? "" : value)}
						onSelect={(id) => {
							selectNode(id);
							setDirectoryOpen(false);
						}}
					/>
				</SheetContent>
			</Sheet>
			<Sheet open={detailOpen} onOpenChange={setDetailOpen}>
				<SheetContent side="right" className="octo-graph-sheet">
					<SheetHeader>
						<SheetTitle>节点详情</SheetTitle>
						<SheetDescription>查看所选节点的属性，并跳转到它的关联。</SheetDescription>
					</SheetHeader>
					{selected && (
						<GraphInspector
							selected={selected}
							neighbors={neighbors}
							degrees={degrees}
							onSelect={selectNode}
							onClose={() => {
								clearSelection();
								setDetailOpen(false);
							}}
						/>
					)}
				</SheetContent>
			</Sheet>
			<Sheet open={tableOpen} onOpenChange={setTableOpen}>
				<SheetContent side="right" className="octo-graph-sheet">
					<SheetHeader>
						<SheetTitle>图谱数据表</SheetTitle>
						<SheetDescription>与图谱相同的节点与关系，可在表格中选择节点。</SheetDescription>
					</SheetHeader>
					<ScrollArea className="octo-graph-sheet-scroll" aria-label="图谱数据表内容">
						<GraphTables
							graph={graph}
							selected={selectedId ? [selectedId] : []}
							onSelected={(ids) => setParam("node", ids[0] ?? "")}
						/>
					</ScrollArea>
				</SheetContent>
			</Sheet>
		</Grid>
	);
}
