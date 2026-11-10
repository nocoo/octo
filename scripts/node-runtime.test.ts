import { describe, expect, it } from "vitest";
import { assertNodeRuntime, MIN_NODE_MAJOR } from "./node-runtime";

describe("node runtime contract", () => {
	it("accepts the CI Node major", () => {
		const major = Number(process.versions.node.split(".")[0] ?? "0");
		expect(major).toBeGreaterThanOrEqual(MIN_NODE_MAJOR);
		expect(assertNodeRuntime()).toBe(0);
	});
});
