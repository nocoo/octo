import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { memoryCreateSchema } from "../../lib/schema/memory";
import type { Env } from "../env";
import { authzFrom, MemoryService } from "../services/memories";
import { updateManagedSpace } from "../services/space-management";
import { testApiPrincipal } from "../test-principal";
import { searchAuthzFromPrincipal } from "./authz";
import * as memoryRead from "./memory-read";
import { searchMemories } from "./service";

afterEach(() => vi.restoreAllMocks());

describe("search during a space rename", () => {
	it.each(["fts", "vector"] as const)(
		"keeps scoped %s results when rename interleaves space reads",
		async (mode) => {
			const { db, sqlite } = sqliteD1();
			try {
				sqlite.exec("UPDATE embedding_profiles SET dims = 2");
				const principal = {
					...testApiPrincipal(),
					scope: "spaces" as const,
					spaceIds: ["space:kb"],
				};
				const memory = await new MemoryService(db).create(
					authzFrom(principal),
					memoryCreateSchema.parse({
						space: "kb",
						title: "rename race",
						body: "rename race",
						type: "note",
						tags: [],
						vector: { profile: "te3-small-1536", values: [1, 0] },
					}),
				);
				const load = memoryRead.loadSpaceSlugMap;
				vi.spyOn(memoryRead, "loadSpaceSlugMap").mockImplementationOnce(async (database) => {
					const snapshot = await load(database);
					await updateManagedSpace(db, testApiPrincipal(), "kb", { slug: "renamed" });
					return snapshot;
				});
				const query = vi.fn(async () => []);
				const request = {
					mode,
					query: "rename",
					filters: { spaces: ["kb", "renamed"] },
					limit: 20,
					...(mode === "vector" ? { vector: { profile: "te3-small-1536", values: [1, 0] } } : {}),
				};
				const deps = {
					db,
					env: { DB: db, RESOURCE_ENV: "production" } as Env,
					vectorStore: { query },
				};
				const result = await searchMemories(searchAuthzFromPrincipal(principal), request, deps);
				expect(result.items).toMatchObject([{ id: memory.id, space: "renamed" }]);
				if (mode === "vector")
					expect(query).toHaveBeenCalledWith(
						expect.objectContaining({
							filter: expect.objectContaining({ space: { $in: ["renamed"] } }),
						}),
					);
				expect(
					(
						await searchMemories(
							{ keyId: "hidden", visibleSpaceIds: ["space:other"] },
							request,
							deps,
						)
					).items,
				).toEqual([]);
				expect(
					(
						await searchMemories(
							searchAuthzFromPrincipal(principal),
							{ ...request, filters: { spaces: ["missing"] } },
							deps,
						)
					).items,
				).toEqual([]);
			} finally {
				sqlite.close();
			}
		},
	);
});
