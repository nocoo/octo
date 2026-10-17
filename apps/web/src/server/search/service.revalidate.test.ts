import { describe, expect, it } from "vitest";
import { memoryPassesTagFilters, revalidateVectorHits } from "./service";

describe("memoryPassesTagFilters", () => {
	it("checks tags_all and tags_any", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: (arg: string) => ({
					all: async () => ({
						results: sql.includes("memory_tags") ? [{ id: "t1", name: "infra" }] : [],
					}),
					first: async () => {
						if (!sql.includes("FROM tags WHERE name")) {
							return null;
						}
						return arg === "infra"
							? { id: "t1", merged_into: null }
							: { id: "t2", merged_into: null };
					},
				}),
			}),
		} as never;
		expect(await memoryPassesTagFilters(db, "m1", { tags_all: ["infra"] })).toBe(true);
		expect(await memoryPassesTagFilters(db, "m1", { tags_all: ["other"] })).toBe(false);
		expect(await memoryPassesTagFilters(db, "m1", { tags_any: ["infra"] })).toBe(true);
		expect(await memoryPassesTagFilters(db, "m1", { tags_any: ["missing"] })).toBe(false);
		expect(await memoryPassesTagFilters(db, "m1", undefined)).toBe(true);
	});
});

describe("revalidateVectorHits", () => {
	it("drops rows that fail sql or tag filters", async () => {
		const db = {
			prepare: () => ({
				bind: (...binds: unknown[]) => ({
					first: async () => (binds.at(-1) === "bad" ? null : { id: binds.at(-1) }),
					all: async () => ({ results: [{ id: "t1", name: "infra" }] }),
				}),
			}),
		} as never;
		const hits = await revalidateVectorHits(
			db,
			[
				{ id: "bad", score: 1 },
				{ id: "m1", score: 0.5 },
			],
			["s1"],
			{ tags_any: ["missing"] },
		);
		expect(hits).toEqual([]);
	});

	it("keeps valid vector hits", async () => {
		const db = {
			prepare: (_sql: string) => ({
				bind: (...binds: unknown[]) => ({
					first: async () => ({ id: binds.at(-1) }),
					all: async () => ({ results: [] }),
				}),
			}),
		} as never;
		const hits = await revalidateVectorHits(db, [{ id: "m1", score: 1 }], ["s1"], undefined);
		expect(hits).toEqual([{ id: "m1", score: 1 }]);
	});
});
