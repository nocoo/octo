import { describe, expect, it } from "vitest";
import { batchGetMemories } from "./batch-get";

describe("batchGetMemories visibility", () => {
	it("treats hidden spaces as missing", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{
								id: "m1",
								space_id: "hidden",
								space_slug: "x",
								title: "t",
								body: "b",
								type: "note",
								importance: 0.5,
								created_at: 1,
								updated_at: 2,
								event_time: null,
							},
						],
					}),
				}),
			}),
		} as never;
		const result = await batchGetMemories(db, { keyId: "k", visibleSpaceIds: ["s1"] }, [
			"m1",
			"m1",
		]);
		expect(result).toEqual({ items: [], missing: ["m1"] });
	});
});
