import { describe, expect, it } from "vitest";
import { searchRequestSchema } from "./search";

describe("searchRequestSchema", () => {
	it("accepts a query-only search", () => {
		expect(searchRequestSchema.parse({ query: "部署 cloudflare" })).toEqual({
			query: "部署 cloudflare",
		});
	});

	it("rejects a request without query or vector", () => {
		expect(searchRequestSchema.safeParse({ limit: 10 }).success).toBe(false);
	});
});
