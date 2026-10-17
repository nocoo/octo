import { describe, expect, it } from "vitest";
import { encodeFloat32Vector, l2Normalize } from "../../search/math";
import { D1BruteForceVectorStore } from "./d1-brute-force";

describe("D1BruteForceVectorStore", () => {
	it("scores vectors with cosine dot product", async () => {
		const a = l2Normalize([1, 0]);
		const b = l2Normalize([0.9, 0.1]);
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{ memory_id: "m1", dim: 2, vector: encodeFloat32Vector(a).buffer },
							{ memory_id: "m2", dim: 2, vector: encodeFloat32Vector(b).buffer },
						],
					}),
				}),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", {
			clauses: ["1 = 1"],
			binds: [],
		});
		const hits = await store.query({ vector: a, topK: 10, returnMetadata: false });
		expect(hits[0]?.id).toBe("m1");
		expect(hits[0]?.score).toBeCloseTo(1);
	});

	it("computes true cosine for scaled queries and stored vectors", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{ memory_id: "same", dim: 2, vector: encodeFloat32Vector([3, 4]).buffer },
							{ memory_id: "opposite", dim: 2, vector: encodeFloat32Vector([-3, -4]).buffer },
						],
					}),
				}),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		const hits = await store.query({ vector: [3e300, 4e300], topK: 10, returnMetadata: false });
		expect(hits.map((hit) => hit.id)).toEqual(["same", "opposite"]);
		expect(hits[0]?.score).toBeCloseTo(1, 12);
		expect(hits[1]?.score).toBeCloseTo(-1, 12);
		await expect(store.query({ vector: [1], topK: 1, returnMetadata: false })).rejects.toThrow(
			"dimension",
		);
	});

	it("handles missing result sets and metadata topK", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ all: async () => ({}) }),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		expect(await store.query({ vector: [1, 0], topK: 80, returnMetadata: true })).toEqual([]);
	});

	it("returns an empty list when no rows match", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ all: async () => ({ results: [] }) }),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		expect(await store.query({ vector: [1, 0], topK: 3, returnMetadata: false })).toEqual([]);
	});
});
