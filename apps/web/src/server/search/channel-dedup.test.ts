import { describe, expect, it } from "vitest";
import { searchMemories } from "./service";

describe("search channel identity", () => {
	it.each(["fts", "vector", "hybrid"] as const)(
		"deduplicates %s candidates by memory before ranking, counting or fusion",
		async (mode) => {
			const memories = ["a", "b"].map((id) => ({
				id,
				space_id: "s1",
				space_slug: "kb",
				title: "title",
				body: "body",
				type: "note",
				importance: 0.5,
				created_at: 1,
				updated_at: 1,
				event_time: null,
				tags_json: "[]",
			}));
			const db = {
				prepare: (sql: string) => {
					const all = async () => ({
						results: sql.includes("FROM spaces")
							? [{ id: "s1", slug: "kb" }]
							: sql.includes("bm25(")
								? [
										{ id: "b", score: -1 },
										{ id: "a", score: -3 },
										{ id: "b", score: -2 },
										{ id: "b", score: -0.5 },
									]
								: memories,
					});
					return {
						all,
						bind: () => ({
							all,
							first: async () => ({ id: "profile", model: "model", dims: 2 }),
						}),
					};
				},
			} as unknown as D1Database;
			const result = await searchMemories(
				{ keyId: "key", visibleSpaceIds: ["s1"] },
				{ query: "body", vector: { profile: "profile", values: [1, 0] }, mode, limit: 2 },
				{
					db,
					vectorStore: {
						query: async () => [
							{ id: "b", score: 0.2 },
							{ id: "a", score: 0.9 },
							{ id: "b", score: 0.8 },
							{ id: "b", score: 0.1 },
						],
					},
				},
			);
			expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
			for (const channel of mode === "hybrid" ? (["fts", "vector"] as const) : [mode]) {
				expect(result.channels[channel].candidates).toBe(2);
				expect(result.items.map((item) => item.scores[channel]?.rank)).toEqual([1, 2]);
			}
			if (mode === "hybrid") {
				expect(result.items[0]?.scores.fused).toBeCloseTo(2 / 61);
				expect(result.items[1]?.scores.fused).toBeCloseTo(2 / 62);
			}
		},
	);
});
