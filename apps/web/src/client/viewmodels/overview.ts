import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { type ListPage, libraryError } from "./library";
import type { UsageDaily } from "./operations-observability";

export function activitySeries(daily: { day: string; key_id: string; calls: number }[]) {
	const keys = [...new Set(daily.map((row) => row.key_id))].sort();
	const colors = keys.map(
		(key) => [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 5,
	);
	const dates = [...new Set(daily.map((row) => row.day))].sort();
	const rows = dates.map((day) => ({
		x: day,
		...Object.fromEntries(
			keys.map((key, index) => [
				`agent_${index}`,
				daily
					.filter((row) => row.day === day && row.key_id === key)
					.reduce((sum, row) => sum + row.calls, 0),
			]),
		),
	})) as ({ x: string } & Record<`agent_${number}`, number>)[];
	const heatmap = dates.map((day) => ({
		date: day,
		value: daily.filter((row) => row.day === day).reduce((sum, row) => sum + row.calls, 0),
	}));
	return { keys, colors, rows, heatmap };
}

interface RecentMemory {
	id: string;
	title: string;
	space: string;
	updated_at: string;
	tags: string[];
}
export interface OverviewChange {
	seq: number;
	entity: string;
	entity_id: string;
	op: string;
	at: string;
	actor?: string;
	space_id?: string | null;
	version?: number | null;
}
interface OverviewState {
	loading: boolean;
	error: string | null;
	memoryCount: number | null;
	trashCount: number | null;
	writesToday: number | null;
	activeKeysToday: number | null;
	usage: UsageDaily[] | null;
	recent: RecentMemory[];
	changes: OverviewChange[];
}

export class OverviewModel extends Store<OverviewState> {
	constructor(
		private readonly api: AdminClient = adminApi,
		private readonly now: () => number = Date.now,
	) {
		super({
			loading: false,
			error: null,
			memoryCount: null,
			trashCount: null,
			writesToday: null,
			activeKeysToday: null,
			usage: null,
			recent: [],
			changes: [],
		});
	}
	private async pages<Item>(path: string, params = new URLSearchParams()): Promise<Item[]> {
		const items: Item[] = [];
		const seen = new Set<string>();
		let cursor: string | null = null;
		do {
			if (cursor) params.set("cursor", cursor);
			const query = params.toString();
			const page: ListPage<Item> = await this.api.request(query ? `${path}?${query}` : path);
			items.push(...page.items);
			cursor = page.next_cursor;
			if (cursor && seen.has(cursor)) throw new Error("pagination_cycle");
			if (cursor) seen.add(cursor);
		} while (cursor);
		return items;
	}
	async load(): Promise<void> {
		if (this.state.loading) return;
		this.set({ loading: true, error: null });
		try {
			const today = new Date(this.now()).toISOString().slice(0, 10);
			const [spaces, usage, memories, trash, changes] = await Promise.all([
				this.pages<{ memory_count: number }>("/spaces"),
				this.pages<UsageDaily>(
					"/usage",
					new URLSearchParams({ from: `${today.slice(0, 4)}-01-01`, to: today, limit: "200" }),
				),
				this.api.request<{ items: RecentMemory[] }>("/memories?limit=12"),
				this.pages<{ id: string }>("/trash", new URLSearchParams({ limit: "200" })),
				this.pages<OverviewChange>("/changes", new URLSearchParams({ limit: "200" })),
			]);
			const todayUsage = usage.filter((row) => row.day === today);
			this.set({
				memoryCount: spaces.reduce((sum, item) => sum + item.memory_count, 0),
				trashCount: trash.length,
				writesToday: todayUsage.reduce((sum, row) => sum + row.writes, 0),
				activeKeysToday: new Set(todayUsage.filter((row) => row.calls > 0).map((row) => row.key_id))
					.size,
				usage,
				recent: memories.items,
				changes: changes.sort((left, right) => right.seq - left.seq).slice(0, 12),
			});
		} catch (error) {
			this.set({ error: `无法刷新总览：${libraryError(error)}` });
		} finally {
			this.set({ loading: false });
		}
	}
}
