import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { searchMemories } from "./service";

function dbWithProfile(dims: number) {
	return {
		prepare: (sql: string) => ({
			all: async () => ({ results: sql.includes("FROM spaces") ? [{ id: "s1", slug: "kb" }] : [] }),
			bind: () => ({
				all: async () => ({ results: [] }),
				first: async () =>
					sql.includes("embedding_profiles") ? { id: "te3-small-1536", model: "m", dims } : null,
			}),
		}),
	} as never;
}

describe("searchMemories vector validation", () => {
	it("rejects unknown embedding profiles", async () => {
		const db = {
			prepare: (sql: string) => ({
				all: async () => ({ results: [] }),
				bind: () => ({
					all: async () => ({ results: [] }),
					first: async () => (sql.includes("embedding_profiles") ? null : null),
				}),
			}),
		} as never;
		await expect(
			searchMemories(
				{ keyId: "k", visibleSpaceIds: "all" },
				{ vector: { profile: "missing", values: [1] }, mode: "vector", limit: 1 },
				{ db },
			),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("rejects non-finite vector values", async () => {
		await expect(
			searchMemories(
				{ keyId: "k", visibleSpaceIds: "all" },
				{
					vector: { profile: "te3-small-1536", values: [Number.NaN, 0] },
					mode: "vector",
					limit: 1,
				},
				{ db: dbWithProfile(2) },
			),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("rejects dimension mismatch", async () => {
		await expect(
			searchMemories(
				{ keyId: "k", visibleSpaceIds: "all" },
				{ vector: { profile: "te3-small-1536", values: [1, 2, 3] }, mode: "vector", limit: 1 },
				{ db: dbWithProfile(2) },
			),
		).rejects.toBeInstanceOf(ApiError);
	});
});
