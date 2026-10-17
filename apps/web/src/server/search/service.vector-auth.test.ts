import { describe, expect, it, vi } from "vitest";
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

	it.each([
		[3, 4],
		[3e300, 4e300],
		[3e-300, 4e-300],
	])("normalizes a query before calling its store: %j", async (...values) => {
		const query = vi.fn(async () => []);
		await searchMemories(
			{ keyId: "k", visibleSpaceIds: ["s1"] },
			{
				vector: { profile: "te3-small-1536", values },
				mode: "vector",
			},
			{ db: dbWithProfile(2), vectorStore: { query } },
		);
		expect(query).toHaveBeenCalledWith(expect.objectContaining({ vector: [0.6, 0.8] }));
	});

	it("rejects zero query vectors", async () => {
		await expect(
			searchMemories(
				{ keyId: "k", visibleSpaceIds: "all" },
				{
					vector: { profile: "te3-small-1536", values: [0, 0] },
					mode: "vector",
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
