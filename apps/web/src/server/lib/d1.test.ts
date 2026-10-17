import { describe, expect, it } from "vitest";
import { probeD1, readTestMarker } from "./d1";

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
