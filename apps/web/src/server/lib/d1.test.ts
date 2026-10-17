import { describe, expect, it } from "vitest";
import {
	chunkBoundParams,
	D1_MAX_BOUND_PARAMS,
	isUniqueConstraint,
	probeD1,
	readTestMarker,
} from "./d1";

function stubD1(first: unknown | (() => never)): D1Database {
	return {
		prepare: () => ({
			bind: () => ({
				first: async () => {
					if (typeof first === "function") {
						(first as () => never)();
					}
					return first as Record<string, unknown> | null;
				},
			}),
			first: async () => {
				if (typeof first === "function") {
					(first as () => never)();
				}
				return first as Record<string, unknown> | null;
			},
		}),
	} as unknown as D1Database;
}

describe("chunkBoundParams", () => {
	it("splits at the D1 bind limit", () => {
		expect(D1_MAX_BOUND_PARAMS).toBe(100);
		expect(chunkBoundParams([])).toEqual([]);
		expect(chunkBoundParams(["a"])).toEqual([["a"]]);
		const ids = Array.from({ length: 101 }, (_, i) => String(i));
		const chunks = chunkBoundParams(ids);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toHaveLength(100);
		expect(chunks[1]).toEqual(["100"]);
	});
});

describe("isUniqueConstraint", () => {
	it("detects sqlite unique failures for a table", () => {
		expect(isUniqueConstraint(new Error("UNIQUE constraint failed: tags.name"), "tags")).toBe(true);
		expect(isUniqueConstraint("UNIQUE constraint failed: spaces.slug", "spaces")).toBe(true);
		expect(isUniqueConstraint(new Error("UNIQUE constraint failed: tags.name"), "spaces")).toBe(
			false,
		);
		expect(isUniqueConstraint(new Error("boom"), "tags")).toBe(false);
	});
});

describe("probeD1", () => {
	it("returns true only for SELECT 1", async () => {
		expect(await probeD1(stubD1({ n: 1 }))).toBe(true);
		expect(await probeD1(stubD1({ n: 0 }))).toBe(false);
		expect(await probeD1(stubD1(null))).toBe(false);
		expect(
			await probeD1(
				stubD1(() => {
					throw new Error("d1");
				}),
			),
		).toBe(false);
	});
});

describe("readTestMarker", () => {
	it("returns test only for the env marker", async () => {
		expect(await readTestMarker(stubD1({ value: "test" }))).toBe("test");
		expect(await readTestMarker(stubD1({ value: "prod" }))).toBeNull();
		expect(
			await readTestMarker(
				stubD1(() => {
					throw new Error("missing");
				}),
			),
		).toBeNull();
	});
});
