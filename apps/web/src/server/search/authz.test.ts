import { describe, expect, it } from "vitest";
import { canReadSpace, intersectRequestedSpaces } from "./authz";

describe("authz helpers", () => {
	const spaces = new Map([
		["s1", "alpha"],
		["s2", "beta"],
	]);

	it("checks visible spaces", () => {
		expect(canReadSpace({ keyId: "k", visibleSpaceIds: ["s1"] }, "s1")).toBe(true);
		expect(canReadSpace({ keyId: "k", visibleSpaceIds: ["s1"] }, "s2")).toBe(false);
		expect(canReadSpace({ keyId: "k", visibleSpaceIds: "all" }, "s2")).toBe(true);
	});

	it("intersects requested slugs with visibility", () => {
		expect(
			intersectRequestedSpaces({ keyId: "k", visibleSpaceIds: ["s1"] }, ["alpha", "beta"], spaces),
		).toEqual(["s1"]);
		expect(
			intersectRequestedSpaces({ keyId: "k", visibleSpaceIds: "all" }, undefined, spaces),
		).toEqual(["s1", "s2"]);
	});
});
