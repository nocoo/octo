import { describe, expect, it } from "vitest";
import { intersectRequestedSpaceIds } from "./authz";

describe("intersectRequestedSpaceIds", () => {
	it("ignores unknown ids", () => {
		const spaces = new Map([["s1", "alpha"]]);
		expect(
			intersectRequestedSpaceIds({ keyId: "k", visibleSpaceIds: "all" }, ["missing"], spaces),
		).toEqual([]);
	});
});
