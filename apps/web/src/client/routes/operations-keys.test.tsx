import type { DataTableProps, DataTableSort } from "@nocoo/basalt/components/data-table";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyUsageModel } from "../viewmodels/operations-key-usage";
import type { KeyMetadata, KeysModel } from "../viewmodels/operations-keys";
import { KeysPage } from "./operations-keys";

const fixture = vi.hoisted(() => ({
	state: {} as Partial<KeysModel["state"]> & { loaded?: boolean },
	usage: {} as Partial<KeyUsageModel["state"]>,
	sort: null as DataTableSort | null,
	open: false,
}));
vi.mock("../viewmodels/operations-key-usage", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-key-usage")>();
	return {
		...module,
		KeyUsageModel: class extends module.KeyUsageModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.usage };
			}
		},
	};
});
vi.mock("../viewmodels/operations-keys", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-keys")>();
	return {
		...module,
		KeysModel: class extends module.KeysModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.state };
			}
		},
	};
});
vi.mock("@nocoo/basalt/components/data-table", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/data-table")>();
	return {
		...module,
		DataTable: (props: DataTableProps<KeyMetadata>) => (
			<module.DataTable {...props} defaultSort={fixture.sort} />
		),
	};
});

const base: KeyMetadata = {
	id: "key-z",
	name: "Zulu",
	role: "admin",
	ops: "r,w,u,d",
	scope: "all",
	space_ids: [],
	own_entries_only: false,
	auto_own_space: false,
	expires_at: "2100-12-01T00:00:00.000Z",
	revoked_at: null,
	last_used_at: "2025-02-01T00:00:00.000Z",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
};
const keys: KeyMetadata[] = [
	base,
	{
		...base,
		id: "key-a",
		name: "Alpha",
		role: "readonly",
		expires_at: "2025-02-01T00:00:00.000Z",
		last_used_at: "2026-12-01T00:00:00.000Z",
	},
	{
		...base,
		id: "key-b",
		name: "Beta",
		role: "drop",
		revoked_at: "2026-01-01T00:00:00.000Z",
		expires_at: null,
		last_used_at: null,
	},
];
const render = () => renderToStaticMarkup(<KeysPage />);
const names = (html: string) => [...html.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);

beforeEach(() => {
	fixture.state = { items: keys, loaded: true };
	fixture.usage = {};
	fixture.sort = null;
	fixture.open = false;
});

describe("key table sorting", () => {
	it("localizes role, scope, operation and status displays without changing user names", () => {
		const html = render();
		for (const text of [
			"管理员",
			"只读",
			"仅投递",
			"全部空间",
			"读取",
			"创建",
			"更新",
			"删除",
			"有效",
			"已过期",
			"已撤销",
			"编辑 Zulu",
			"轮换 Zulu",
			"撤销 Zulu",
		])
			expect(html).toContain(text);
		expect(html).toContain("Alpha");
		expect(html).not.toMatch(
			/>\s*(?:admin|readonly|drop|all|active|expired|revoked|r,w,u,d)\s*(?:<|\/)/,
		);
	});
	it.each([
		["name", ["Alpha", "Beta", "Zulu"]],
		["role", ["Beta", "Alpha", "Zulu"]],
		["status", ["Beta", "Alpha", "Zulu"]],
		["expiry", ["Alpha", "Zulu", "Beta"]],
		["last", ["Zulu", "Alpha", "Beta"]],
	] as const)("sorts %s using domain values in both directions", (id, expected) => {
		fixture.sort = { id, dir: "asc" };
		expect(names(render())).toEqual(expected);
		fixture.sort = { id, dir: "desc" };
		expect(names(render())).toEqual([...expected].reverse());
	});

	it("renders metadata with separately unknown usage instead of inventing a key usage property", () => {
		const html = render();
		expect(html).toContain("用量尚未加载");
		expect(html).not.toContain("次调用");
		expect(html).not.toContain("Invalid Date");
		expect(html).toContain(new Date(base.last_used_at ?? "").toLocaleString("zh-CN"));
	});
});

describe("independent key usage displays", () => {
	const snapshot = {
		from: "2026-09-18",
		to: "2026-10-17",
		days: Array.from({ length: 30 }, (_, index) =>
			new Date(Date.parse("2026-09-18T00:00:00Z") + index * 86400000).toISOString().slice(0, 10),
		),
		calls: new Map([["key-z", new Map([["2026-10-17", 8]])]]),
	};
	it("renders installed Basalt sparklines with Chinese per-key labels, totals and daily alternatives", () => {
		fixture.usage = { snapshot };
		const html = render();
		expect(html).toContain('aria-label="Zulu 近 30 天每日调用量"');
		expect(html).toContain('aria-label="Alpha 近 30 天每日调用量"');
		expect(html).toContain("8 次调用");
		expect(html).toContain("0 次调用");
		expect(html).toContain("2026-09-18 至 2026-10-17（UTC）");
		expect(html).toContain("2026-10-17：8 次");
		expect(html).toContain("2026-09-18：0 次");
		expect(html).toContain("basalt-chart");
		expect(html).not.toContain("用量尚未加载");
	});

	it.each([
		[{ loading: true }, "正在加载用量"],
		[{ error: "无法加载密钥用量。" }, "用量不可用"],
	] as const)("does not draw zero sparklines for unavailable usage: %j", (usage, message) => {
		fixture.usage = usage;
		const html = render();
		expect(names(html)).toEqual(["Zulu", "Alpha", "Beta"]);
		expect(html).toContain(message);
		expect(html).not.toContain("basalt-chart");
		expect(html).not.toContain("0 次调用");
		expect(html).toContain("创建密钥");
		if ("error" in usage) expect(html).toContain("重试用量");
	});

	it.each([
		[{ loading: true }, "用量刷新中；当前图表为上次成功数据。"],
		[{ error: "无法加载密钥用量。" }, "用量刷新失败；当前图表为上次成功数据。"],
	] as const)("labels retained snapshots as stale: %j", (usage, message) => {
		fixture.usage = { ...usage, snapshot };
		const html = render();
		expect(html).toContain(message);
		expect(html).toContain("8 次调用");
		expect(html).toContain("2026-10-17：8 次");
	});
});

describe("key read states", () => {
	it.each([null, "无法加载接口密钥。"])("does not assert an empty unknown list: %s", (error) => {
		fixture.state = { items: [], loaded: false, error };
		const html = render();
		expect(html).not.toContain("暂无接口密钥。");
		if (error) expect(html).toContain(error);
	});

	it("distinguishes successful emptiness and retains rows on refresh error", () => {
		fixture.state = { items: [], loaded: true };
		expect(render()).toContain("暂无接口密钥。");
		fixture.state = { items: [base], loaded: true, error: "无法加载接口密钥。" };
		const html = render();
		expect(names(html)).toEqual(["Zulu"]);
		expect(html).toContain("无法加载接口密钥。");
	});
});
