import { describe, expect, it } from "vitest";
import { batchGetMemories } from "./batch-get";

describe("batchGetMemories", () => {
	it("hides inaccessible and missing ids", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: (..._args: unknown[]) => ({
					all: async () => {
						if (sql.includes("FROM memories m")) {
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
						}
						return { results: [{ memory_id: "m1", name: "infra" }] };
					},
				}),
			}),
		} as never;
		const result = await batchGetMemories(db, { keyId: "k", visibleSpaceIds: ["s1"] }, [
			"m1",
			"m2",
		]);
		expect(result.items).toHaveLength(1);
		expect(result.missing).toEqual(["m2"]);
	});
});
