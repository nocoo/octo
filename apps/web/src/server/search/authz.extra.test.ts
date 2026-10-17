import { describe, expect, it } from "vitest";
import { intersectRequestedSpaces } from "./authz";

describe("intersectRequestedSpaces", () => {
	it("ignores unknown slugs", () => {
		const spaces = new Map([["s1", "alpha"]]);
		expect(
			intersectRequestedSpaces({ keyId: "k", visibleSpaceIds: "all" }, ["missing"], spaces),
		).toEqual([]);
	});
});
