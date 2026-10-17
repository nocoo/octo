import { describe, expect, it } from "vitest";
import { searchMemories } from "./service";

const memory = {
	id: "m1",
	space_id: "s1",
	space_slug: "kb",
	title: "t",
	body: "text",
	type: "note",
	importance: 0.5,
	created_at: 1,
	updated_at: 2,
	event_time: null,
	tags_json: "[]",
};

function dbFrom(handler: (sql: string) => Promise<{ results: unknown[] }>) {
	return {
		prepare: (sql: string) => ({
			all: async () => handler(sql),
			bind: () => ({
				all: async () => handler(sql),
				first: async () => {
					if (sql.includes("embedding_profiles")) {
						return { id: "te3-small-1536", model: "m", dims: 2 };
					}
					return sql.includes("m.id = ?") ? { id: "m1" } : null;
				},
			}),
		}),
	} as never;
}

describe("searchMemories branches", () => {
	it("infers hybrid mode and returns both channel scores", async () => {
		const db = dbFrom(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [] };
			}
			return { results: [memory] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{
				query: "cloudflare",
				vector: { profile: "te3-small-1536", values: [1, 0] },
				limit: 1,
			},
			{ db, vectorStore: { query: async () => [{ id: "m1", score: 0.7 }] } },
		);
		expect(result.items[0]?.scores.fts).toBeNull();
		expect(result.items[0]?.scores.vector?.similarity).toBe(0.7);
		expect(result.channels.vector.profile).toBe("te3-small-1536");
	});

	it("skips missing memory rows in the fused list", async () => {
		const db = dbFrom(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [{ id: "missing", score: -1 }] };
			}
			return { results: [] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{ query: "cloudflare", mode: "fts", limit: 5 },
			{ db },
		);
		expect(result.items).toEqual([]);
	});

	it("uses fts fused scores without a vector profile", async () => {
		const db = dbFrom(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [{ id: "m1", score: -2 }] };
			}
			return { results: [memory] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{ query: "cloudflare", mode: "fts", limit: 1 },
			{ db },
		);
		expect(result.channels.vector.profile).toBeNull();
		expect(result.items[0]?.scores.fts?.bm25).toBe(-2);
	});

	it("omits snippet when not requested", async () => {
		const db = dbFrom(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [{ id: "m1", score: -2 }] };
			}
			return { results: [memory] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{ query: "cloudflare", mode: "fts", limit: 1 },
			{ db },
		);
		expect(result.items[0]).not.toHaveProperty("snippet");
	});

	it("breaks fused-score ties by updated_at", async () => {
		const m2 = { ...memory, id: "m2", updated_at: 99 };
		const db = dbFrom(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return {
					results: [
						{ id: "m1", score: -1 },
						{ id: "m2", score: -1 },
					],
				};
			}
			if (sql.includes("m.id IN")) {
				return { results: [memory, m2] };
			}
			return { results: [memory, m2] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{ query: "cloudflare", mode: "fts", limit: 5 },
			{ db },
		);
		expect(result.items.map((i) => i.id)).toEqual(["m2", "m1"]);
	});

	it("honors custom fusion settings", async () => {
		const db = dbFrom(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("memories_fts")) {
				return { results: [{ id: "m1", score: -1 }] };
			}
			return { results: [memory] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{
				query: "cloudflare",
				vector: { profile: "te3-small-1536", values: [1, 0] as number[] },
				fusion: { method: "rrf", k: 10, weights: { fts: 2, vector: 1 } },
				limit: 1,
			},
			{ db, vectorStore: { query: async () => [{ id: "m1", score: 0.5 }] } },
		);
		expect(result.items[0]?.scores.fused).toBeGreaterThan(0);
	});
});
