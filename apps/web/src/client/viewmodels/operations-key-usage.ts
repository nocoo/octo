import { z } from "zod";
import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { operationsError } from "./operations-errors";

const usagePage = z.object({
	items: z.array(
		z.object({
			day: z.iso.date(),
			key_id: z.string().min(1),
			calls: z.number().int().nonnegative(),
		}),
	),
	next_cursor: z.string().min(1).nullable(),
});
interface UsageSnapshot {
	from: string;
	to: string;
	days: string[];
	calls: Map<string, Map<string, number>>;
}
interface KeyUsageState {
	snapshot: UsageSnapshot | null;
	loading: boolean;
	error: string | null;
}

export class KeyUsageModel extends Store<KeyUsageState> {
	private revision = 0;
	private alive = true;
	constructor(
		private readonly api: AdminClient = adminApi,
		private readonly now: () => number = Date.now,
	) {
		super({ snapshot: null, loading: false, error: null });
	}

	usage(keyId: string): { data: { x: string; calls: number }[]; total: number } | null {
		const snapshot = this.state.snapshot;
		if (!snapshot) return null;
		const calls = snapshot.calls.get(keyId);
		const data = snapshot.days.map((day) => ({ x: day, calls: calls?.get(day) ?? 0 }));
		return { data, total: data.reduce((sum, point) => sum + point.calls, 0) };
	}

	async load(): Promise<void> {
		if (!this.alive) return;
		const revision = ++this.revision;
		const to = new Date(this.now()).toISOString().slice(0, 10);
		const midnight = Date.parse(`${to}T00:00:00Z`);
		const days = Array.from({ length: 30 }, (_, index) =>
			new Date(midnight - (29 - index) * 86400000).toISOString().slice(0, 10),
		);
		const from = days[0] as string;
		const query = new URLSearchParams({ from, to, limit: "200" });
		const calls = new Map<string, Map<string, number>>();
		const cursors = new Set<string>();
		this.set({ loading: true, error: null });
		try {
			while (true) {
				const result = await this.api.request<unknown>(`/usage?${query}`);
				if (!this.alive || revision !== this.revision) return;
				const page = usagePage.parse(result);
				for (const row of page.items) {
					if (row.day < from || row.day > to) throw new Error("Usage day outside requested range");
					let daily = calls.get(row.key_id);
					if (!daily) {
						daily = new Map();
						calls.set(row.key_id, daily);
					}
					daily.set(row.day, row.calls);
				}
				if (page.next_cursor === null) break;
				if (cursors.has(page.next_cursor)) throw new Error("Repeated usage cursor");
				cursors.add(page.next_cursor);
				query.set("cursor", page.next_cursor);
			}
			this.set({ snapshot: { from, to, days, calls }, loading: false });
		} catch (error) {
			if (this.alive && revision === this.revision)
				this.set({ loading: false, error: operationsError(error, "无法加载密钥用量。") });
		}
	}

	dispose(): void {
		this.alive = false;
		this.revision++;
		this.set({ loading: false });
	}
}
