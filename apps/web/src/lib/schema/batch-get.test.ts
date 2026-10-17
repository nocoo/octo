import { describe, expect, it } from "vitest";
import { batchGetRequestSchema } from "./batch-get";

describe("batchGetRequestSchema", () => {
	it("accepts up to 100 ids", () => {
		expect(batchGetRequestSchema.parse({ ids: ["a"] }).ids).toEqual(["a"]);
	});

	it("rejects empty ids", () => {
		expect(batchGetRequestSchema.safeParse({ ids: [] }).success).toBe(false);
	});

	it("rejects more than 100 ids", () => {
		const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
		expect(batchGetRequestSchema.safeParse({ ids }).success).toBe(false);
	});
});
