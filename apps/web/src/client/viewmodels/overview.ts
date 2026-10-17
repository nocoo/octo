import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { libraryError } from "./library";
import type { UsageResponse } from "./operations-observability";

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
interface OverviewState {
	loading: boolean;
	error: string | null;
	memoryCount: number | null;
	usage: UsageResponse | null;
	recent: RecentMemory[];
}

export class OverviewModel extends Store<OverviewState> {
	constructor(private readonly api: AdminClient = adminApi) {
		super({ loading: false, error: null, memoryCount: null, usage: null, recent: [] });
	}
	async load(): Promise<void> {
		this.set({ loading: true, error: null });
		try {
			const [spaces, usage, memories] = await Promise.all([
				this.api.request<{ items: { memory_count: number }[] }>("/spaces"),
				this.api.request<UsageResponse>("/usage"),
				this.api.request<{ items: RecentMemory[] }>("/memories?limit=12"),
			]);
			this.set({
				memoryCount: spaces.items.reduce((sum, item) => sum + item.memory_count, 0),
				usage,
				recent: memories.items,
			});
		} catch (error) {
			this.set({ error: `无法刷新总览：${libraryError(error)}` });
		} finally {
			this.set({ loading: false });
		}
	}
}
