import { describe, expect, it } from "vitest";
import type { AdminClient } from "../lib/api";
import { navigation, pageTitle, ShellModel, shortcut } from "./shell";

describe("shell navigation and identity", () => {
	it("matches descendants and unknown routes", () => {
		expect(pageTitle("/")).toBe("总览");
		expect(pageTitle("/memories/one/edit")).toBe("记忆库");
		expect(pageTitle("/settings/embedding")).toBe("向量模型");
		expect(pageTitle("/spaces")).toBe("空间");
		expect(pageTitle("/keys")).toBe("接口密钥");
		expect(pageTitle("/missing")).toBe("页面不存在");
		expect(new Set(navigation.map((item) => item.href)).size).toBe(navigation.length);
	});
	it("reserves shortcuts without hijacking editable controls", () => {
		expect(shortcut("k", true, false)).toBe("palette");
		expect(shortcut("k", true, true)).toBe("palette");
		expect(shortcut("/", false, false)).toBe("search");
		expect(shortcut("/", false, true)).toBeNull();
		expect(shortcut("j", false, false)).toBeNull();
	});
	it("loads Access identity, reporting auth errors without pretending login", async () => {
		const api = { request: async () => ({ email: "owner@example.test" }) } as AdminClient;
		const model = new ShellModel(api);
		await model.load();
		expect(model.state.email).toBe("owner@example.test");
		expect(model.state.error).toBeNull();
		const failing = new ShellModel({
			request: async () => {
				throw new Error("secret");
			},
		});
		await failing.load();
		expect(failing.state.email).toBeNull();
		expect(failing.state.error).toBe("无法验证 Access 身份，请刷新后重试。");
	});
});
