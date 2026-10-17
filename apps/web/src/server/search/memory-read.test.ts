import { describe, expect, it } from "vitest";
import { loadMemoriesByIds, loadSpaceSlugMap, memoryToApi } from "./memory-read";

describe("memory-read", () => {
	it("returns an empty map for no ids", async () => {
		expect(
			await loadMemoriesByIds({} as D1Database, [], { clauses: ["1 = 0"], binds: [] }),
		).toEqual(new Map());
	});

	it("loads spaces and formats the content and tags snapshot", async () => {
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
			tags_json: '["infra","ops"]',
		};
		const db = {
			prepare: (sql: string) => ({
				all: async () => ({
					results: sql.includes("FROM spaces") ? [{ id: "s1", slug: "kb" }] : [],
				}),
				bind: () => ({ all: async () => ({ results: [row] }) }),
			}),
		} as never;
		expect(await loadSpaceSlugMap(db)).toEqual(new Map([["s1", "kb"]]));
		const memories = await loadMemoriesByIds(db, ["m1"], {
			clauses: ["m.space_id = ?"],
			binds: ["s1"],
		});
		expect(memories.get("m1")).toEqual(row);
		expect(memoryToApi(row)).toMatchObject({
			tags: ["infra", "ops"],
			event_time: new Date(3).toISOString(),
		});
	});
});
