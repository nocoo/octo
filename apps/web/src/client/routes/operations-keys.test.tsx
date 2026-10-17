import type { DataTableProps, DataTableSort } from "@nocoo/basalt/components/data-table";
import type { ComponentProps } from "react";
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
vi.mock("@nocoo/basalt", async (original) => {
	const module = await original<typeof import("@nocoo/basalt")>();
	return {
		...module,
		Collapsible: (props: ComponentProps<typeof module.Collapsible>) => (
			<module.Collapsible {...props} defaultOpen={fixture.open} />
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
	expires_at: Date.parse("2100-12-01"),
	revoked_at: null,
	last_used_at: Date.parse("2025-02-01"),
	created_at: 1,
	usage: [],
};
const keys: KeyMetadata[] = [
	base,
	{
		...base,
		id: "key-a",
		name: "Alpha",
		role: "readonly",
		expires_at: Date.parse("2025-02-01"),
		last_used_at: Date.parse("2026-12-01"),
	},
	{
		...base,
		id: "key-b",
		name: "Beta",
		role: "drop",
		revoked_at: 1,
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

	it.each([false, true])("uses Basalt disclosure for sparkline values, open=%s", (open) => {
		fixture.state = { items: [{ ...base, usage: [2, 10] }], loaded: true };
		fixture.open = open;
		const html = render();
		expect(html).not.toMatch(/<(?:details|summary)\b/);
		expect(html).toContain(`aria-expanded="${open}"`);
		expect(html).toContain("数值");
		if (open) {
			expect(html).toContain("aria-controls=");
			expect(html).toContain('aria-label="Zulu 的近期调用数据"');
			expect(html).toMatch(/<td[^>]*>10<\/td>/);
		} else expect(html).not.toContain('aria-label="Zulu 的近期调用数据"');
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
