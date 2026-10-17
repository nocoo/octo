import { describe, expect, it } from "vitest";
import { DEFAULT_FUSION, fuseChannels } from "./fusion";
import { encodeFloat32Vector, l2Normalize } from "./math";
import { searchMemories } from "./service";

describe("search fusion defaults", () => {
	it("uses rrf k=60", () => {
		const fused = fuseChannels([{ id: "a", rank: 1, rawScore: 1 }], [], DEFAULT_FUSION);
		expect(fused.get("a")).toBeCloseTo(1 / 61);
	});
});

describe("searchMemories", () => {
	it("returns fts-only results", async () => {
		const query = async (sql: string) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [{ id: "m1", score: -3 }] };
			}
			if (sql.includes("memory_tags")) {
				return { results: [] };
			}
			return {
				results: [
					{
						id: "m1",
						space_id: "s1",
						space_slug: "kb",
						title: "t",
						body: "cloudflare",
						type: "note",
						importance: 0.5,
						created_at: 1,
						updated_at: 2,
						event_time: null,
					},
				],
			};
		};
		const db = {
			prepare: (sql: string) => ({
				all: async () => query(sql),
				bind: () => ({
					all: async () => query(sql),
					first: async () => null,
				}),
			}),
		} as never;
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{ query: "cloudflare", mode: "fts", limit: 5 },
			{ db },
		);
		expect(result.items[0]?.id).toBe("m1");
		expect(result.channels.fts.candidates).toBe(1);
	});

	it("merges vector hits in hybrid mode", async () => {
		const memory = {
			id: "m1",
			space_id: "s1",
			space_slug: "kb",
			title: "t",
			body: "cloudflare notes",
			type: "note",
			importance: 0.5,
			created_at: 1,
			updated_at: 2,
			event_time: null,
		};
		const query = async (sql: string) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [{ id: "m1", score: -2 }] };
			}
			return { results: [memory] };
		};
		const db = {
			prepare: (sql: string) => ({
				all: async () => query(sql),
				bind: () => ({
					all: async () => query(sql),
					first: async () => {
						if (sql.includes("embedding_profiles")) {
							return { id: "te3-small-1536", model: "m", dims: 2 };
						}
						return sql.includes("m.id = ?") ? { id: "m1" } : null;
					},
				}),
			}),
		} as never;
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{
				query: "cloudflare",
				vector: { profile: "te3-small-1536", values: [1, 0] },
				mode: "hybrid",
				include: ["snippet"],
				limit: 5,
			},
			{
				db,
				vectorStore: {
					query: async () => [{ id: "m1", score: 0.95 }],
				},
			},
		);
		expect(
			result.items[0] && "snippet" in result.items[0] ? result.items[0].snippet : "",
		).toContain("<mark>");
		expect(result.channels.vector.candidates).toBe(1);
	});

	it("supports vector-only search", async () => {
		const memory = {
			id: "m1",
			space_id: "s1",
			space_slug: "kb",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			created_at: 1,
			updated_at: 5,
			event_time: null,
		};
		const query = async (sql: string) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			return { results: [memory] };
		};
		const db = {
			prepare: (sql: string) => ({
				all: async () => query(sql),
				bind: () => ({
					all: async () => query(sql),
					first: async () => {
						if (sql.includes("embedding_profiles")) {
							return { id: "te3-small-1536", model: "m", dims: 1 };
						}
						return sql.includes("m.id = ?") ? { id: "m1" } : null;
					},
				}),
			}),
		} as never;
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: ["s1"] },
			{ vector: { profile: "te3-small-1536", values: [1] }, mode: "vector", limit: 1 },
			{ db, vectorStore: { query: async () => [{ id: "m1", score: 0.5 }] } },
		);
		expect(result.items[0]?.scores.vector?.similarity).toBe(0.5);
	});

	it("uses the explicitly local D1 brute-force vector store", async () => {
		const vec = encodeFloat32Vector(l2Normalize([1, 0]));
		const query = async (sql: string) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memory_vectors")) {
				return {
					results: [{ memory_id: "m1", dim: 2, vector: vec.buffer }],
				};
			}
			return {
				results: [
					{
						id: "m1",
						space_id: "s1",
						space_slug: "kb",
						title: "t",
						body: "b",
						type: "note",
						importance: 0.5,
						created_at: 1,
						updated_at: 2,
						event_time: null,
					},
				],
			};
		};
		const db = {
			prepare: (sql: string) => ({
				all: async () => query(sql),
				bind: () => ({
					all: async () => query(sql),
					first: async () => {
						if (sql.includes("embedding_profiles")) {
							return { id: "te3-small-1536", model: "m", dims: 2 };
						}
						return sql.includes("m.id = ?") ? { id: "m1" } : null;
					},
				}),
			}),
		} as never;
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{ vector: { profile: "te3-small-1536", values: [1, 0] }, mode: "vector", limit: 1 },
			{ db, env: { DB: db, FILES: {} as R2Bucket, ASSETS: {} as Fetcher, RESOURCE_ENV: "test" } },
		);
		expect(result.items[0]?.id).toBe("m1");
	});
});
