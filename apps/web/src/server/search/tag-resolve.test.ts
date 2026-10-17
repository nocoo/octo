import { describe, expect, it } from "vitest";
import { resolveCanonicalTagIds } from "./tag-resolve";

describe("resolveCanonicalTagIds", () => {
	it("follows merge redirects", async () => {
		const db = {
			prepare: (_sql: string) => ({
				bind: (name: string) => ({
					first: async () => {
						if (name === "old") {
							return { id: "t1", merged_into: "t2" };
						}
						if (name === "t2") {
							return { id: "t2", merged_into: null };
						}
						return null;
					},
				}),
			}),
		} as never;
		expect(await resolveCanonicalTagIds(db, ["old"])).toEqual(["t2"]);
	});

	it("stops when merge target disappears", async () => {
		const db = {
			prepare: () => ({
				bind: (name: string) => ({
					first: async () => {
						if (name === "old") {
							return { id: "t1", merged_into: "missing" };
						}
						return null;
					},
				}),
			}),
		} as never;
		expect(await resolveCanonicalTagIds(db, ["old"])).toEqual(["t1"]);
	});
});
