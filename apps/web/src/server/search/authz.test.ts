import { describe, expect, it } from "vitest";
import { parseOps } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import {
	canReadSpace,
	intersectRequestedSpaceIds,
	requireSearchRead,
	searchAuthzFromPrincipal,
} from "./authz";

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

	it("maps principals to visible space ids", () => {
		expect(
			searchAuthzFromPrincipal({
				id: "k1",
				name: "n",
				role: "admin",
				ops: parseOps("r"),
				scope: "all",
				spaceIds: [],
				ownedSpaceIds: [],
				ownEntriesOnly: false,
				autoOwnSpace: false,
				expiresAt: null,
			}),
		).toEqual({ keyId: "k1", visibleSpaceIds: "all" });
	});

	it("forbids scope-all keys without read op", () => {
		expect(() =>
			requireSearchRead({
				id: "k1",
				name: "n",
				role: "admin",
				ops: parseOps("w"),
				scope: "all",
				spaceIds: [],
				ownedSpaceIds: [],
				ownEntriesOnly: false,
				autoOwnSpace: false,
				expiresAt: null,
			}),
		).toThrow(ApiError);
	});

	it("allows scoped keys with read but no visible spaces", () => {
		expect(() =>
			requireSearchRead({
				id: "k1",
				name: "n",
				role: "drop",
				ops: parseOps("r"),
				scope: "spaces",
				spaceIds: [],
				ownedSpaceIds: [],
				ownEntriesOnly: false,
				autoOwnSpace: false,
				expiresAt: null,
			}),
		).not.toThrow();
	});

	it("requires read access via authorize for scoped keys", () => {
		const principal = {
			id: "k1",
			name: "n",
			role: "drop",
			ops: parseOps("r"),
			scope: "spaces" as const,
			spaceIds: ["s1"],
			ownedSpaceIds: [],
			ownEntriesOnly: false,
			autoOwnSpace: false,
			expiresAt: null,
		};
		expect(() => requireSearchRead(principal)).not.toThrow();
		expect(() =>
			requireSearchRead({
				...principal,
				ops: parseOps("w"),
			}),
		).toThrow(ApiError);
	});

	it.each(["all", "spaces", "own"] as const)(
		"checks read independently from empty %s scope",
		(scope) => {
			const principal = {
				id: "k1",
				name: "n",
				role: "project",
				scope,
				ops: parseOps("w"),
				spaceIds: [],
				ownedSpaceIds: [],
				ownEntriesOnly: false,
				autoOwnSpace: true,
				expiresAt: null,
			};
			expect(() => requireSearchRead(principal)).toThrow(ApiError);
			expect(() => requireSearchRead({ ...principal, ops: parseOps("r") })).not.toThrow();
		},
	);

	it("intersects requested ids with visibility", () => {
		expect(
			intersectRequestedSpaceIds({ keyId: "k", visibleSpaceIds: ["s1"] }, ["s1", "s2"], spaces),
		).toEqual(["s1"]);
		expect(
			intersectRequestedSpaceIds({ keyId: "k", visibleSpaceIds: "all" }, undefined, spaces),
		).toEqual(["s1", "s2"]);
		expect(intersectRequestedSpaceIds({ keyId: "k", visibleSpaceIds: "all" }, [], spaces)).toEqual(
			[],
		);
	});
});
