import { describe, expect, it } from "vitest";
import { searchMemories } from "./service";

function memory(id: string, updated = 1) {
	return {
		id,
		space_id: "s1",
		space_slug: "kb",
		title: "t",
		body: "b",
		type: "note",
		importance: 0.5,
		created_at: 1,
		updated_at: updated,
		event_time: null,
	};
}

function makeDb(handler: (sql: string) => Promise<{ results: unknown[] }>) {
	return {
		prepare: (sql: string) => ({
			all: async () => handler(sql),
			bind: (...binds: unknown[]) => ({
				all: async () => handler(sql),
				first: async () => {
					if (sql.includes("embedding_profiles")) {
						return { id: "te3-small-1536", model: "m", dims: 1 };
					}
					if (sql.includes("m.id = ?") && binds[binds.length - 1] === "ghost") {
						return null;
					}
					if (sql.includes("m.id = ?")) {
						return { id: binds[binds.length - 1] };
					}
					if (sql.includes("memory_tags mt JOIN tags")) {
						return { results: [{ id: "t1", name: "infra" }] };
					}
					if (sql.includes("FROM tags WHERE name")) {
						return { id: "t1", merged_into: null };
					}
					return null;
				},
			}),
		}),
	} as never;
}

describe("searchMemories edge cases", () => {
	it("drops vector ghosts and marks truncation with tag filters", async () => {
		const db = makeDb(async (sql) => {
			if (sql.includes("FROM spaces")) {
				return { results: [{ id: "s1", slug: "kb" }] };
			}
			if (sql.includes("FROM memories m")) {
				return { results: [memory("m1")] };
			}
			if (sql.includes("memory_tags")) {
				return { results: [{ memory_id: "m1", name: "infra" }] };
			}
			return { results: [] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: ["s1"] },
			{
				vector: { profile: "te3-small-1536", values: [1] },
				filters: { tags_all: ["infra"] },
				mode: "vector",
				limit: 1,
			},
			{
				db,
				vectorStore: {
					query: async () => Array.from({ length: 5 }, () => ({ id: "ghost", score: 1 })),
				},
			},
		);
		expect(result.channels.vector.truncated).toBe(true);
		expect(result.items).toEqual([]);
	});

	it("breaks fused ties by updated_at", async () => {
		const db = makeDb(async (sql) => {
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
			return { results: [memory("m1", 1), memory("m2", 9)] };
		});
		const result = await searchMemories(
			{ keyId: "k", visibleSpaceIds: "all" },
			{
				query: "cloudflare",
				mode: "fts",
				limit: 2,
				fusion: { method: "weighted", weights: { fts: 1, vector: 1 } },
			},
			{ db },
		);
		expect(result.items.map((i) => i.id)).toEqual(["m2", "m1"]);
	});
});
