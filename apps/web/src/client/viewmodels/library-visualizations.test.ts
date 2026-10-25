import { describe, expect, it } from "vitest";
import type { LibraryMemory } from "./library";
import {
	buildGraph,
	buildTimeline,
	filterGraphNodes,
	filterMemories,
	graphDegrees,
	graphFocus,
	graphMainComponent,
	graphNeighbors,
	graphOptions,
	rankGraphNodes,
	selectedGraphNode,
	timelineOptions,
	updateLibraryUrl,
} from "./library-visualizations";

const memories: LibraryMemory[] = [
	{
		id: "a",
		title: "First",
		space: "work",
		tags: ["alpha", "beta", "alpha"],
		version: 1,
		created_at: "2026-10-16T23:00:00Z",
		event_time: "2026-10-17T02:00:00Z",
	},
	{
		id: "b",
		title: "Second",
		space: "home",
		tags: ["alpha", "beta", "gamma"],
		version: 1,
		created_at: "2026-10-17T01:00:00Z",
		event_time: null,
	},
	{
		id: "c",
		title: "Undated",
		space: "home",
		tags: [],
		version: 1,
		created_at: "invalid",
		event_time: null,
	},
];
describe("library URL filters", () => {
	it("treats URL as sole selection and filter source", () => {
		const params = new URLSearchParams("space=work&q=FIRST&selected=a");
		expect(filterMemories(memories, params).map((item) => item.id)).toEqual(["a"]);
		expect(filterMemories(memories, new URLSearchParams("q=gamma"))).toHaveLength(1);
		expect(filterMemories(memories, new URLSearchParams())).toHaveLength(3);
		expect(updateLibraryUrl(params, "space", "").toString()).toBe("q=FIRST&selected=a");
		expect(updateLibraryUrl(params, "q", "beta").get("q")).toBe("beta");
	});
	it("normalizes graph caps, modes and invalid URL values", () => {
		expect(graphOptions(new URLSearchParams())).toEqual({ mode: "bipartite", cap: 150 });
		expect(graphOptions(new URLSearchParams("mode=cooccurrence&cap=2"))).toEqual({
			mode: "cooccurrence",
			cap: 10,
		});
		expect(graphOptions(new URLSearchParams("cap=1000"))).toMatchObject({ cap: 500 });
		expect(graphOptions(new URLSearchParams("mode=bad&cap=NaN"))).toEqual({
			mode: "bipartite",
			cap: 150,
		});
	});
});
describe("graph projection", () => {
	it("builds deduplicated bipartite edges with stable namespaced IDs", () => {
		const graph = buildGraph(memories, "bipartite", 150);
		expect(graph.nodes).toHaveLength(6);
		expect(graph.links).toHaveLength(5);
		expect(graph.nodes.find((node) => node.id === "memory:a")).toMatchObject({
			label: "First",
			kind: "memory",
			count: 1,
			href: "/memories/a",
		});
		expect(graph.nodes.find((node) => node.id === "tag:alpha")?.href).toContain("tags_all=alpha");
		expect(graph.clustered).toBe(0);
	});
	it("counts cooccurrence once per memory with no self edges", () => {
		const graph = buildGraph(memories, "cooccurrence", 150);
		expect(graph.nodes).toHaveLength(3);
		expect(graph.links).toContainEqual({ source: "tag:alpha", target: "tag:beta", value: 2 });
		expect(graph.links).toHaveLength(3);
	});
	it.each(["bipartite", "cooccurrence"] as const)(
		"clusters excess %s nodes and aggregates edges within the cap",
		(mode) => {
			const many = Array.from({ length: 30 }, (_unused, index) => ({
				...(memories[0] as LibraryMemory),
				id: String(index),
				tags: [`tag${index}`, "shared"],
			}));
			const graph = buildGraph(many, mode, 10);
			expect(graph.nodes.length).toBeLessThanOrEqual(10);
			expect(graph.clustered).toBeGreaterThan(0);
			expect(graph.nodes.some((node) => node.kind === "cluster")).toBe(true);
			expect(
				graph.nodes
					.filter((node) => node.kind === "cluster")
					.every((node) => /^\d+ 个(?:标签|记忆)节点$/.test(node.label)),
			).toBe(true);
			const ids = new Set(graph.nodes.map((node) => node.id));
			expect(
				graph.links.every(
					(link) => ids.has(link.source) && ids.has(link.target) && link.source !== link.target,
				),
			).toBe(true);
		},
	);
	it("handles empty graphs and separator characters in tag names", () => {
		expect(buildGraph([], "cooccurrence", 10)).toEqual({ nodes: [], links: [], clustered: 0 });
		expect(
			buildGraph(
				[{ ...(memories[0] as LibraryMemory), tags: ["a|b", "c", "a", "b|c"] }],
				"cooccurrence",
				10,
			).links,
		).toHaveLength(6);
	});
});
describe("timeline projection", () => {
	it("normalizes field, zoom and range from URL", () => {
		expect(timelineOptions(new URLSearchParams())).toEqual({
			field: "event_time",
			zoom: "day",
			from: null,
			to: null,
		});
		expect(
			timelineOptions(new URLSearchParams("field=created_at&zoom=month&from=2026-10-01&to=bad")),
		).toEqual({ field: "created_at", zoom: "month", from: Date.parse("2026-10-01"), to: null });
		expect(timelineOptions(new URLSearchParams("field=bad&zoom=hour"))).toMatchObject({
			field: "event_time",
			zoom: "hour",
		});
		expect(timelineOptions(new URLSearchParams("zoom=bad"))).toMatchObject({ zoom: "day" });
	});
	it("uses event time without inventing dates, created time separately and zoom groups", () => {
		const events = buildTimeline(memories, timelineOptions(new URLSearchParams()));
		expect(events.undated).toBe(2);
		expect(events.groups[0]?.label).toBe("2026-10-17");
		expect(events.groups[0]?.items[0]?.id).toBe("a");
		const created = buildTimeline(
			memories,
			timelineOptions(new URLSearchParams("field=created_at&zoom=hour")),
		);
		expect(created.undated).toBe(1);
		expect(created.groups.map((group) => group.label)).toEqual([
			"2026-10-16T23:00Z",
			"2026-10-17T01:00Z",
		]);
		expect(
			buildTimeline(memories, timelineOptions(new URLSearchParams("field=created_at&zoom=month")))
				.groups,
		).toHaveLength(1);
	});
	it("filters by inclusive range, preserves deterministic ordering and drops invalid dates", () => {
		const range = timelineOptions(
			new URLSearchParams("field=created_at&from=2026-10-17&to=2026-10-18"),
		);
		expect(buildTimeline(memories, range).groups[0]?.items.map((item) => item.id)).toEqual(["b"]);
		const tied = [
			{ ...(memories[1] as LibraryMemory), id: "z" },
			{ ...(memories[1] as LibraryMemory), id: "a" },
		];
		expect(
			buildTimeline(tied, { ...range, from: null, to: null }).groups[0]?.items.map(
				(item) => item.id,
			),
		).toEqual(["a", "z"]);
	});
});

describe("graph inspection model", () => {
	const graph = buildGraph(memories, "bipartite", 150);

	it("carries memory metadata for the inspector", () => {
		expect(graph.nodes.find((node) => node.id === "memory:a")).toMatchObject({
			space: "work",
			tags: ["alpha", "beta"],
			time: "2026-10-17T02:00:00Z",
		});
		expect(graph.nodes.find((node) => node.id === "memory:b")?.time).toBe("2026-10-17T01:00:00Z");
	});

	it("counts each link on both endpoints", () => {
		const degrees = graphDegrees(graph);
		expect(degrees.get("tag:alpha")).toBe(2);
		expect(degrees.get("memory:a")).toBe(2);
		expect(degrees.get("tag:gamma")).toBe(1);
		expect(degrees.get("memory:c")).toBe(0);
	});

	it("ranks tags before memories, then by degree, count and label", () => {
		expect(rankGraphNodes(graph).map((node) => [node.id, node.degree])).toEqual([
			["tag:alpha", 2],
			["tag:beta", 2],
			["tag:gamma", 1],
			["memory:b", 3],
			["memory:a", 2],
			["memory:c", 0],
		]);
	});

	it("filters the directory without rebuilding the graph", () => {
		const ranked = rankGraphNodes(graph);
		expect(filterGraphNodes(ranked, "  GAM ", "all").map((node) => node.id)).toEqual(["tag:gamma"]);
		expect(filterGraphNodes(ranked, "", "memory")).toHaveLength(3);
		expect(filterGraphNodes(ranked, "", "tag")).toHaveLength(3);
		expect(filterGraphNodes(ranked, "missing", "all")).toHaveLength(0);
	});

	it("lists neighbours by link strength and exposes the one-hop focus set", () => {
		expect(
			graphNeighbors(graph, "tag:alpha").map((neighbor) => [neighbor.node.id, neighbor.value]),
		).toEqual([
			["memory:a", 1],
			["memory:b", 1],
		]);
		expect(graphNeighbors(graph, "memory:c")).toEqual([]);
		expect([...(graphFocus(graph, "memory:a") ?? [])].sort()).toEqual([
			"memory:a",
			"tag:alpha",
			"tag:beta",
		]);
		expect(graphFocus(graph, "memory:unknown")).toBeNull();
		expect(graphFocus(graph, null)).toBeNull();
	});

	it("resolves the selected node from the URL param", () => {
		expect(selectedGraphNode(graph, "tag:beta")?.label).toBe("beta");
		expect(selectedGraphNode(graph, "tag:missing")).toBeNull();
		expect(selectedGraphNode(graph, null)).toBeNull();
	});
});

describe("graph main component", () => {
	it("returns the largest connected component and ignores isolates", () => {
		const graph = buildGraph(memories, "bipartite", 150);
		const mainComponent = graphMainComponent(graph);
		expect([...mainComponent].sort()).toEqual([
			"memory:a",
			"memory:b",
			"tag:alpha",
			"tag:beta",
			"tag:gamma",
		]);
		expect(mainComponent.has("memory:c")).toBe(false);
	});

	it("keeps the first component when sizes tie", () => {
		const graph = buildGraph(memories, "cooccurrence", 150);
		expect([...graphMainComponent(graph)].sort()).toEqual(["tag:alpha", "tag:beta", "tag:gamma"]);
	});

	it("handles an empty graph", () => {
		expect(graphMainComponent({ nodes: [], links: [], clustered: 0 }).size).toBe(0);
	});
});
