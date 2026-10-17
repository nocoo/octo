import { describe, expect, it } from "vitest";
import {
	loadMemoriesByIds,
	loadSpaceSlugMap,
	loadTagsForMemories,
	memoryToApi,
} from "./memory-read";

describe("memory-read", () => {
	it("returns empty maps for no ids", async () => {
		const db = {
			prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
		} as never;
		expect(await loadMemoriesByIds(db, [], { clauses: ["1 = 0"], binds: [] })).toEqual(new Map());
		expect(await loadTagsForMemories(db, [])).toEqual(new Map());
	});

	it("loads spaces, memories, tags, and formats api rows", async () => {
		const row = {
			id: "m1",
			space_id: "s1",
			space_slug: "kb",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			created_at: 1,
			updated_at: 2,
			event_time: 3,
		};
		const db = {
			prepare: (sql: string) => ({
				all: async () => {
					if (sql.includes("FROM spaces")) {
						return { results: [{ id: "s1", slug: "kb" }] };
					}
					if (sql.includes("memory_tags")) {
						return {
							results: [
								{ memory_id: "m1", name: "infra" },
								{ memory_id: "m1", name: "ops" },
							],
						};
					}
					return { results: [row] };
				},
				bind: () => ({
					all: async () => {
						if (sql.includes("memory_tags")) {
							return {
								results: [
									{ memory_id: "m1", name: "infra" },
									{ memory_id: "m1", name: "ops" },
								],
							};
						}
						return { results: [row] };
					},
				}),
			}),
		} as never;
		expect(await loadSpaceSlugMap(db)).toEqual(new Map([["s1", "kb"]]));
		const memories = await loadMemoriesByIds(db, ["m1"], {
			clauses: ["m.space_id = ?"],
			binds: ["s1"],
		});
		const tags = await loadTagsForMemories(db, ["m1"]);
		expect(tags.get("m1")).toEqual(["infra", "ops"]);
		const stored = memories.get("m1");
		expect(stored).toBeDefined();
		const apiRow = memoryToApi(stored as NonNullable<typeof stored>, tags.get("m1") ?? []);
		expect(apiRow.event_time).toBe(new Date(3).toISOString());
	});
});
