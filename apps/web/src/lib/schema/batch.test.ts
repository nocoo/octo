import { describe, expect, it } from "vitest";
import { batchCreateBodySchema } from "./batch";

describe("batchCreateBodySchema", () => {
	it("accepts large item arrays for route-level limits", () => {
		const items = Array.from({ length: 101 }, () => ({
			space: "s",
			title: "t",
			body: "b",
			type: "note" as const,
			tags: [] as string[],
		}));
		expect(batchCreateBodySchema.safeParse({ items }).success).toBe(true);
	});
});
