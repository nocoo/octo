import type { LibraryMemory } from "./library";

export function updateLibraryUrl(
	params: URLSearchParams,
	key: string,
	value: string,
): URLSearchParams {
	const next = new URLSearchParams(params);
	if (value) next.set(key, value);
	else next.delete(key);
	return next;
}
export function filterMemories(
	memories: LibraryMemory[],
	params: URLSearchParams,
): LibraryMemory[] {
	const space = params.get("space");
	const query = (params.get("q") ?? "").trim().toLocaleLowerCase();
	return memories.filter(
		(item) =>
			(!space || item.space === space) &&
			(!query || [item.title, ...item.tags].join(" ").toLocaleLowerCase().includes(query)),
	);
}
export type GraphMode = "bipartite" | "cooccurrence";
export interface GraphNode {
	id: string;
	label: string;
	kind: "tag" | "memory" | "cluster";
	count: number;
	href: string | null;
}
export interface GraphLink {
	source: string;
	target: string;
	value: number;
}
export interface LibraryGraph {
	nodes: GraphNode[];
	links: GraphLink[];
	clustered: number;
}

export function graphOptions(params: URLSearchParams): { mode: GraphMode; cap: number } {
	const value = Number(params.get("cap") ?? "150");
	return {
		mode: params.get("mode") === "cooccurrence" ? "cooccurrence" : "bipartite",
		cap: Number.isFinite(value) ? Math.min(500, Math.max(10, Math.floor(value))) : 150,
	};
}

function addEdge(edges: Map<string, GraphLink>, source: string, target: string, value = 1): void {
	if (source === target) return;
	const key = JSON.stringify([source, target]);
	const previous = edges.get(key);
	if (previous) previous.value += value;
	else edges.set(key, { source, target, value });
}

export function buildGraph(memories: LibraryMemory[], mode: GraphMode, cap: number): LibraryGraph {
	const nodes = new Map<string, GraphNode>();
	const edges = new Map<string, GraphLink>();
	for (const memory of memories) {
		const tags = [...new Set(memory.tags)].sort();
		for (const tag of tags) {
			const id = `tag:${tag}`;
			const existing = nodes.get(id);
			if (existing) existing.count += 1;
			else
				nodes.set(id, {
					id,
					label: tag,
					kind: "tag",
					count: 1,
					href: `/memories?${new URLSearchParams({ tags_all: tag })}`,
				});
		}
		if (mode === "bipartite") {
			const id = `memory:${memory.id}`;
			nodes.set(id, {
				id,
				label: memory.title,
				kind: "memory",
				count: 1,
				href: `/memories/${encodeURIComponent(memory.id)}`,
			});
			for (const tag of tags) addEdge(edges, `tag:${tag}`, id);
		} else {
			tags.forEach((tag, index) => {
				for (const other of tags.slice(index + 1)) addEdge(edges, `tag:${tag}`, `tag:${other}`);
			});
		}
	}
	const ranked = [...nodes.values()].sort(
		(left, right) => right.count - left.count || left.id.localeCompare(right.id),
	);
	if (ranked.length <= cap) return { nodes: ranked, links: [...edges.values()], clustered: 0 };
	const kept = ranked.slice(0, Math.max(0, cap - 2));
	const retained = new Set(kept.map((node) => node.id));
	const clustered = ranked.slice(kept.length);
	const mapped = new Map<string, string>();
	for (const node of clustered) {
		const id = `cluster:${node.kind}`;
		mapped.set(node.id, id);
		const group = kept.find((item) => item.id === id);
		if (group) {
			group.count += 1;
			group.label = `${group.count} 个${node.kind === "tag" ? "标签" : "记忆"}节点`;
		} else
			kept.push({
				id,
				kind: "cluster",
				label: `1 个${node.kind === "tag" ? "标签" : "记忆"}节点`,
				count: 1,
				href: null,
			});
	}
	const grouped = new Map<string, GraphLink>();
	for (const link of edges.values()) {
		const source = retained.has(link.source) ? link.source : (mapped.get(link.source) as string);
		const target = retained.has(link.target) ? link.target : (mapped.get(link.target) as string);
		const pair =
			mode === "cooccurrence"
				? ([source, target].sort() as [string, string])
				: ([source, target] as [string, string]);
		addEdge(grouped, pair[0], pair[1], link.value);
	}
	return { nodes: kept, links: [...grouped.values()], clustered: clustered.length };
}

export interface TimelineOptions {
	field: "event_time" | "created_at";
	zoom: "hour" | "day" | "month";
	from: number | null;
	to: number | null;
}
export function timelineOptions(params: URLSearchParams): TimelineOptions {
	const date = (key: string) => {
		const value = Date.parse(params.get(key) ?? "");
		return Number.isFinite(value) ? value : null;
	};
	const zoom = params.get("zoom");
	return {
		field: params.get("field") === "created_at" ? "created_at" : "event_time",
		zoom: zoom === "hour" || zoom === "month" ? zoom : "day",
		from: date("from"),
		to: date("to"),
	};
}
export interface TimelineGroup {
	label: string;
	items: (LibraryMemory & { timestamp: number })[];
}
export function buildTimeline(
	memories: LibraryMemory[],
	options: TimelineOptions,
): { groups: TimelineGroup[]; undated: number } {
	let undated = 0;
	const dated: (LibraryMemory & { timestamp: number })[] = [];
	for (const item of memories) {
		const timestamp = Date.parse(item[options.field] ?? "");
		if (!Number.isFinite(timestamp)) {
			undated += 1;
			continue;
		}
		if (
			(options.from !== null && timestamp < options.from) ||
			(options.to !== null && timestamp > options.to)
		)
			continue;
		dated.push({ ...item, timestamp });
	}
	dated.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
	const groups = new Map<string, TimelineGroup>();
	for (const item of dated) {
		const iso = new Date(item.timestamp).toISOString();
		const label =
			options.zoom === "month"
				? iso.slice(0, 7)
				: options.zoom === "hour"
					? `${iso.slice(0, 13)}:00Z`
					: iso.slice(0, 10);
		const group = groups.get(label);
		if (group) group.items.push(item);
		else groups.set(label, { label, items: [item] });
	}
	return { groups: [...groups.values()], undated };
}
