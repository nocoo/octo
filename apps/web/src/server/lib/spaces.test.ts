import { describe, expect, it } from "vitest";
import { resolveSpaceIdBySlug } from "./spaces";

describe("resolveSpaceIdBySlug", () => {
	it("returns the space id for a known slug", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => ({ id: "sp-kb" }),
				}),
			}),
		} as unknown as D1Database;
		expect(await resolveSpaceIdBySlug(db, "kb")).toBe("sp-kb");
	});

	it("returns null when the slug is missing", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => null,
				}),
			}),
		} as unknown as D1Database;
		expect(await resolveSpaceIdBySlug(db, "missing")).toBeNull();
	});
});
