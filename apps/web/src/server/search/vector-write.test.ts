import { describe, expect, it } from "vitest";
import { assertVectorValues, loadEmbeddingProfile, vectorBlobFromValues } from "./vector-write";

describe("vector write helpers", () => {
	it("normalizes and encodes vectors", () => {
		const blob = vectorBlobFromValues([3, 4], 2);
		expect(blob.byteLength).toBe(8);
	});

	it("rejects dimension mismatch", () => {
		expect(() => assertVectorValues([1], 2)).toThrow("vector dimension mismatch");
	});

	it("rejects zero vectors", () => {
		expect(() => assertVectorValues([0, 0], 2)).toThrow("zero vector");
	});

	it("rejects non-finite values", () => {
		expect(() => assertVectorValues([Number.NaN], 1)).toThrow("finite");
	});

	it("returns null for missing profiles", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => null,
				}),
			}),
		} as never;
		expect(await loadEmbeddingProfile(db, "missing")).toBeNull();
	});

	it("loads active profiles", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => ({ id: "p1", model: "m", dims: 2 }),
				}),
			}),
		} as never;
		expect(await loadEmbeddingProfile(db, "p1")).toEqual({ id: "p1", model: "m", dims: 2 });
	});
});
