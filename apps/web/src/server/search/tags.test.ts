import { describe, expect, it } from "vitest";
import { normalizeTagName } from "./tags";

describe("normalizeTagName", () => {
	it("trims and lowercases latin letters", () => {
		expect(normalizeTagName("  Infra ")).toBe("infra");
	});

	it("preserves CJK characters", () => {
		expect(normalizeTagName("运维")).toBe("运维");
	});
});
