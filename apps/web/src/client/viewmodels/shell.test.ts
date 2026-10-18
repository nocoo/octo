import { describe, expect, it } from "vitest";
import type { AdminClient } from "../lib/api";
import { headerCrumbs, initials, navigation, pageTitle, ShellModel, shortcut } from "./shell";

describe("shell navigation and identity", () => {
	it("matches descendants and unknown routes", () => {
		expect(pageTitle("/")).toBe("总览");
		expect(pageTitle("/memories/one")).toBe("记忆详情");
		expect(pageTitle("/memories/one/edit")).toBe("编辑记忆");
		expect(pageTitle("/memories/one/history")).toBe("版本历史");
		expect(pageTitle("/settings/embedding")).toBe("向量模型");
		expect(pageTitle("/spaces")).toBe("空间");
		expect(pageTitle("/keys")).toBe("接口密钥");
		expect(pageTitle("/usage")).toBe("每日用量");
		expect(pageTitle("/missing")).toBe("页面不存在");
		expect(new Set(navigation.map((item) => item.href)).size).toBe(navigation.length);
	});
	it("keeps only real ancestor destinations in the breadcrumb trail", () => {
		expect(headerCrumbs("/")).toEqual([{ label: "总览" }]);
		expect(headerCrumbs("/memories/one/history")).toEqual([
			{ href: "/memories", label: "记忆库" },
			{ href: "/memories/one", label: "记忆详情" },
			{ label: "版本历史" },
		]);
		expect(headerCrumbs("/memories/one/edit").at(-1)).toEqual({ label: "编辑记忆" });
		expect(headerCrumbs("/memories/one")).toEqual([
			{ href: "/memories", label: "记忆库" },
			{ label: "记忆详情" },
		]);
		expect(headerCrumbs("/settings/embedding")).toEqual([
			{ href: "/", label: "工作台" },
			{ label: "向量模型" },
		]);
		expect(headerCrumbs("/missing").at(-1)).toEqual({ label: "页面不存在" });
	});
	it("uses short identity initials when an avatar cannot load", () => {
		expect(initials("Li Zheng")).toBe("LZ");
		expect(initials("  owner  ")).toBe("OW");
		expect(initials("李政")).toBe("李政");
		expect(initials("")).toBe("");
	});
	it("reserves shortcuts without hijacking editable controls", () => {
		expect(shortcut("k", true, false)).toBe("palette");
		expect(shortcut("k", true, true)).toBe("palette");
		expect(shortcut("/", false, false)).toBe("search");
		expect(shortcut("/", false, true)).toBeNull();
		expect(shortcut("j", false, false)).toBeNull();
	});
	it("loads Access identity, reporting auth errors without pretending login", async () => {
		const api = {
			request: async () => ({
				email: "owner@example.test",
				name: "Li Zheng",
				avatar: "https://lizheng.blog/avatar.png",
			}),
		} as AdminClient;
		const model = new ShellModel(api);
		await model.load();
		expect(model.state.email).toBe("owner@example.test");
		expect(model.state.name).toBe("Li Zheng");
		expect(model.state.avatar).toBe("https://lizheng.blog/avatar.png");
		expect(model.state.error).toBeNull();
		const failing = new ShellModel({
			request: async () => {
				throw new Error("secret");
			},
		});
		await failing.load();
		expect(failing.state.email).toBeNull();
		expect(failing.state.name).toBeNull();
		expect(failing.state.avatar).toBeNull();
		expect(failing.state.error).toBe("无法验证 Access 身份，请刷新后重试。");
	});
	it("accepts a verified identity with no published author profile", async () => {
		const model = new ShellModel({
			request: async () => ({ email: "owner@example.test", name: null, avatar: null }),
		} as AdminClient);
		await model.load();
		expect(model.state).toEqual({
			email: "owner@example.test",
			name: null,
			avatar: null,
			error: null,
		});
	});
});
