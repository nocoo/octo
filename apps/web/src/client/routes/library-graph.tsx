import { Button } from "@nocoo/basalt";
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
			setWidth(element.clientWidth);
			setHeight(element.clientHeight);
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
		<div className="library-stack">
			<div className="library-actions">
				<Button size="sm" variant="outline" onClick={() => force.current?.zoomToFit(0, 24)}>
					Fit graph
				</Button>
				<span className="library-muted">
					Drag to pan. Scroll to zoom. Use the node table for keyboard navigation.
				</span>
			</div>
			<div
				ref={host}
				className="library-graph"
				role="img"
				aria-label="Force-directed relationship graph. Equivalent node and relationship tables follow."
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
			</div>
			<p className="library-muted" aria-live="polite">
				{hover || "Blue: tags. Green: memories. Gray: clustered nodes."}
			</p>
		</div>
	);
}
