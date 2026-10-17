import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { operationsError } from "./operations-errors";

describe("safe Chinese operations errors", () => {
	it.each([
		["embedder_unavailable", "嵌入服务暂时不可用。"],
		["vector_dimension_mismatch", "向量维度不匹配。"],
		["access_denied", "无权访问，请检查 Access 登录状态。"],
		["forbidden", "没有执行此操作的权限。"],
		["validation_failed", "提交的数据不符合要求。"],
	] as const)("translates known code %s", (code, message) => {
		expect(operationsError(code)).toBe(message);
		expect(operationsError(new ApiError(400, code))).toBe(message);
	});
	it("never exposes unknown errors or object-prototype properties", () => {
		for (const error of [new Error("secret"), "private-key", "toString", "constructor", null]) {
			expect(operationsError(error)).toBe("操作失败，请稍后重试。");
			expect(operationsError(error, "无法加载审计日志。")).toBe("无法加载审计日志。");
		}
	});
});
