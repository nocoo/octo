import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./api";
import { apiFieldErrors, issueFieldErrors } from "./field-errors";

const messages = { name: "请填写有效的空间名称。", description: "说明过长。" };

describe("field issue mapping", () => {
	it("maps Zod issue paths to the matching localized fields", () => {
		const result = z
			.object({ name: z.string().min(1), description: z.string().max(1) })
			.safeParse({ name: "", description: "long" });
		if (result.success) throw new Error("Expected invalid fixture");
		expect(issueFieldErrors(result.error.issues, messages)).toEqual(messages);
	});
	it("maps nested paths while ignoring unknown, root and prototype fields", () => {
		expect(
			issueFieldErrors(
				[
					{ path: "name.0" },
					{ path: ["description", 0] },
					{ path: [] },
					{ path: "unknown" },
					{ path: "toString" },
					{ path: [0] },
					{ path: "__proto__" },
				],
				messages,
			),
		).toEqual(messages);
	});
	it("uses only safe field messages for API validation errors", () => {
		expect(
			apiFieldErrors(
				new ApiError(400, "validation_failed", { issues: [{ path: "name" }] }),
				messages,
			),
		).toEqual({ name: messages.name });
	});
	it.each([
		new Error("private"),
		null,
		new ApiError(503, "unavailable"),
		new ApiError(400, "validation_failed"),
	])("ignores errors without matching validation issues: %s", (error) => {
		expect(apiFieldErrors(error, messages)).toEqual({});
	});
});
