import { Button } from "@nocoo/basalt";
import { Grid, GridItem } from "@nocoo/basalt/components/grid";
import { Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useSearchParams } from "react-router";
import type { GraphNode, LibraryGraph } from "../viewmodels/library-visualizations";
import { updateLibraryUrl } from "../viewmodels/library-visualizations";

export default function LibraryGraphCanvas({ graph }: { graph: LibraryGraph }) {
	const [params, setParams] = useSearchParams();
	const host = useRef<HTMLDivElement>(null);
	const force = useRef<ForceGraphMethods<GraphNode> | undefined>(undefined);
	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);
	const [reduced, setReduced] = useState(false);
	const [hover, setHover] = useState("");
	const [colors, setColors] = useState({
		tag: "",
		memory: "",
		cluster: "",
		text: "",
		link: "",
		selected: "",
		font: 12,
		fontFamily: "",
	});
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
		const measure = () => {
			const style = getComputedStyle(element);
			setWidth(
				element.clientWidth -
					Number.parseFloat(style.paddingLeft) -
					Number.parseFloat(style.paddingRight),
			);
			setHeight(
				element.clientHeight -
					Number.parseFloat(style.paddingTop) -
					Number.parseFloat(style.paddingBottom),
			);
		};
		const palette = () => {
			const style = getComputedStyle(element);
			const color = (name: string) => `hsl(${style.getPropertyValue(`--basalt-${name}`).trim()})`;
			setColors({
				tag: color("chart-1"),
				memory: color("chart-3"),
				cluster: color("chart-5"),
				text: color("foreground"),
				link: color("muted-foreground"),
				selected: color("primary"),
				font: Number.parseFloat(style.fontSize),
				fontFamily: style.fontFamily,
			});
		};
		const motion = matchMedia("(prefers-reduced-motion: reduce)");
		const preference = () => setReduced(motion.matches);
		const resize = new ResizeObserver(measure);
		const theme = new MutationObserver(palette);
		resize.observe(element);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style", "data-mode"],
		});
		motion.addEventListener("change", preference);
		measure();
		palette();
		preference();
		return () => {
			resize.disconnect();
			theme.disconnect();
			motion.removeEventListener("change", preference);
		};
	}, []);
	return (
		<Grid columns={1}>
			<Grid gap="sm" style={{ gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center" }}>
				<Button size="sm" variant="outline" onClick={() => force.current?.zoomToFit(0, 24)}>
					<Maximize2 size={16} aria-hidden="true" />
					适应画布
				</Button>
				<span className="text-basalt-sm text-basalt-muted-foreground">
					拖动平移，滚动缩放。也可通过节点表格使用键盘浏览。
				</span>
			</Grid>
			<GridItem
				{...{ ref: host }}
				className="h-basalt-80 w-full overflow-hidden"
				role="img"
				aria-label="力导向关系图。下方提供内容相同的节点与关系表格。"
			>
				{width > 0 && height > 0 && colors.tag && (
					<ForceGraph2D<GraphNode>
						ref={force}
						width={width}
						height={height}
						graphData={data}
						backgroundColor="transparent"
						nodeVal={(node) => Math.max(1, Math.sqrt(node.count))}
						nodeLabel={() => ""}
						nodeColor={(node) =>
							node.id === params.get("node") ? colors.selected : colors[node.kind]
						}
						linkColor={() => colors.link}
						linkWidth={(link) => Math.min(5, Math.sqrt(Number(link.value)))}
						warmupTicks={reduced ? 150 : 30}
						cooldownTicks={reduced ? 0 : 120}
						enableNodeDrag={!reduced}
						onEngineStop={() => force.current?.zoomToFit(0, 24)}
						onNodeHover={(node) => setHover(node?.label ?? "")}
						onNodeClick={(node) => setParams(updateLibraryUrl(params, "node", node.id))}
						nodeCanvasObjectMode={() => "after"}
						nodeCanvasObject={(node, context, scale) => {
							if (node.x === undefined || node.y === undefined) return;
							context.font = `${colors.font / scale}px ${colors.fontFamily}`;
							context.fillStyle = colors.text;
							context.textAlign = "center";
							context.fillText(node.label, node.x, node.y + 12 / scale);
						}}
					/>
				)}
			</GridItem>
			<p className="text-basalt-sm text-basalt-muted-foreground" aria-live="polite">
				{hover || "蓝色：标签；绿色：记忆；灰色：聚合节点。"}
			</p>
		</Grid>
	);
}
