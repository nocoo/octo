import { describe, expect, it } from "vitest";
import { resolveCanonicalTagIds, resolveRequiredTagIds } from "./tag-resolve";

describe("resolveCanonicalTagIds", () => {
	it("normalizes Latin names while preserving unknowns and redirects", async () => {
		const db = {
			prepare: () => ({
				bind: (name: string) => ({
					first: async () => {
						if (name === "café") return { id: "old", merged_into: "canonical" };
						if (name === "canonical") return { id: "canonical", merged_into: null };
						return null;
					},
				}),
			}),
		} as never;
		expect(await resolveRequiredTagIds(db, ["CAFÉ", "café"])).toEqual(["canonical"]);
		expect(await resolveRequiredTagIds(db, ["CAFÉ", "unknown"])).toBeNull();
		expect(await resolveCanonicalTagIds(db, ["unknown", "CAFÉ"])).toEqual(["canonical"]);
	});
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
