import { describe, expect, it, vi } from "vitest";
import type { AdminClient } from "../lib/api";
import {
	backTarget,
	headerCrumbs,
	initials,
	navigation,
	pageTitle,
	ShellModel,
	shortcut,
} from "./shell";

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
			{ href: "/settings", label: "设置" },
			{ label: "向量模型" },
		]);
		expect(headerCrumbs("/missing").at(-1)).toEqual({ label: "页面不存在" });
	});
	it("returns through browser history or a real parent on direct entry", () => {
		expect(backTarget("/memories/one/edit", 2)).toBe(-1);
		expect(backTarget("/memories/one/history", 0)).toBe("/memories/one");
		expect(backTarget("/memories/one", undefined)).toBe("/memories");
		expect(backTarget("/settings/embedding", null)).toBe("/settings");
		expect(backTarget("/spaces", -1)).toBe("/");
		expect(backTarget("/", "2")).toBe("/");
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
	it("deduplicates repeated effects and keeps identity for the SPA session", async () => {
		const identity = { email: "architie@gmail.com", name: "Zheng Li", avatar: "/avatar.png" };
		const request = vi.fn(async () => identity);
		const api = { request } as AdminClient;
		const model = new ShellModel(api);
		const first = model.load();
		const repeated = model.load();
		expect(repeated).toBe(first);
		expect(request).toHaveBeenCalledExactlyOnceWith("/whoami");
		await Promise.all([first, repeated]);
		await model.load();
		expect(request).toHaveBeenCalledTimes(1);
		expect(model.state).toEqual({ ...identity, error: null });
		const nextSession = new ShellModel(api);
		await nextSession.load();
		expect(request).toHaveBeenCalledTimes(2);
	});
	it("keeps a null public profile without repeating the verified identity request", async () => {
		const request = vi.fn(async () => ({
			email: "owner@example.test",
			name: null,
			avatar: null,
		}));
		const model = new ShellModel({ request } as AdminClient);
		await model.load();
		await model.load();
		expect(request).toHaveBeenCalledTimes(1);
		expect(model.state.email).toBe("owner@example.test");
	});
	it("allows the existing retry after an identity request fails", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private failure"))
			.mockResolvedValue({ email: "owner@example.test", name: null, avatar: null });
		const model = new ShellModel({ request });
		await Promise.all([model.load(), model.load()]);
		expect(request).toHaveBeenCalledTimes(1);
		expect(model.state.error).toBe("无法验证 Access 身份，请刷新后重试。");
		await model.load();
		expect(request).toHaveBeenCalledTimes(2);
		expect(model.state.error).toBeNull();
		await model.load();
		expect(request).toHaveBeenCalledTimes(2);
	});
});
