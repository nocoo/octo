import type { DataTableProps, DataTableSort } from "@nocoo/basalt/components/data-table";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyMetadata, KeysModel } from "../viewmodels/operations-keys";
import { KeysPage } from "./operations-keys";

const fixture = vi.hoisted(() => ({
	state: {} as Partial<KeysModel["state"]> & { loaded?: boolean },
	sort: null as DataTableSort | null,
	open: false,
}));
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

	it("renders the real metadata DTO without an invented usage series", () => {
		const html = render();
		expect(html).not.toContain("近期调用");
		expect(html).not.toContain("Invalid Date");
		expect(html).toContain(new Date(base.last_used_at ?? "").toLocaleString("zh-CN"));
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
