import { describe, expect, it, vi } from "vitest";
import { encodeFloat32Vector, l2Normalize } from "../../search/math";
import { CloudflareVectorStore } from "./cloudflare";
import { D1BruteForceVectorStore } from "./d1-brute-force";
import type { VectorStore } from "./types";

const queryVector = l2Normalize([0.2, 0.8]);

function fakeCloudflareStore(rows: Array<{ id: string; score: number }>): VectorStore {
	return new CloudflareVectorStore({
		query: vi.fn(async () => ({ matches: rows.map((r) => ({ id: r.id, score: r.score })) })),
	} as never);
}

function fakeD1Store(rows: Array<{ id: string; vector: number[] }>): VectorStore {
	const db = {
		prepare: () => ({
			bind: () => ({
				all: async () => ({
					results: rows.map((r) => ({
						memory_id: r.id,
						dim: r.vector.length,
						vector: encodeFloat32Vector(l2Normalize(r.vector)).buffer,
					})),
				}),
			}),
		}),
	} as never;
	return new D1BruteForceVectorStore(db, "p1", { clauses: ["1 = 1"], binds: [] });
}

const suites: Array<{ name: string; make: () => VectorStore }> = [
	{
		name: "CloudflareVectorStore",
		make: () => fakeCloudflareStore([{ id: "a", score: 0.7 }]),
	},
	{
		name: "D1BruteForceVectorStore",
		make: () => fakeD1Store([{ id: "a", vector: [0.2, 0.8] }]),
	},
];

describe.each(suites)("$name contract", ({ make }) => {
	it("returns scored ids", async () => {
		const hits = await make().query({
			vector: queryVector,
			topK: 5,
			returnMetadata: false,
		});
		expect(hits[0]?.id).toBe("a");
		expect(hits[0]?.score).toBeGreaterThan(0);
	});
});
