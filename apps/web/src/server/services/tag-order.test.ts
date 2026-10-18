import { describe, expect, it } from "vitest";
import { insertSpace, migratedSqlite } from "../repo/__tests__/sqlite-d1";
import { commitTagWrite } from "../repo/__tests__/tag-write";
import { TagRepo } from "../repo/tags";
import { loadMemoriesByIds, memoryToApi } from "../search/memory-read";
import { testApiPrincipal } from "../test-principal";
import { authzFrom, MemoryService } from "./memories";

describe("tag write order", () => {
	it("preserves normalized first occurrences across reads, snapshots, updates and rollback", async () => {
		const { raw, d1 } = migratedSqlite();
		try {
			await insertSpace(d1, { id: "space", slug: "space" });
			const service = new MemoryService(d1);
			const authz = authzFrom(testApiPrincipal());
			const created = await service.create(authz, {
				space: "space",
				title: "Order",
				body: "Tag order",
				type: "note",
				tags: [" Zulu ", "Ａlpha", "zulu", "中文", "alpha"],
			});
			const id = String(created.id);
			const tags = ["zulu", "alpha", "中文"];
			expect(created.tags).toEqual(tags);
			expect((await service.get(authz, id, new Set())).tags).toEqual(tags);
			expect((await service.getVersion(authz, id, 1)).tags).toEqual(tags);
			const loaded = await loadMemoriesByIds(d1, [id], {
				clauses: ["m.deleted_at IS NULL"],
				binds: [],
			});
			expect([...loaded.values()].map(memoryToApi)[0]?.tags).toEqual(tags);
			const edited = await service.patch(
				authz,
				id,
				{ body: "Edited", expected_version: 1 },
				undefined,
			);
			expect(edited.tags).toEqual(tags);
			expect(await service.diff(authz, id, 1, 2)).toMatchObject({
				fields: [{ field: "body", from: "Tag order", to: "Edited" }],
			});
			const reordered = ["中文", "alpha", "zulu"];
			expect(
				await service.patch(authz, id, { tags: reordered, expected_version: 2 }, undefined),
			).toMatchObject({ tags: reordered, version: 3 });
			expect(await service.diff(authz, id, 2, 3)).toMatchObject({
				fields: [{ field: "tags", from: tags, to: reordered }],
			});
			expect(await service.rollback(authz, id, 1, "3")).toMatchObject({ tags, version: 4 });
			expect((await service.get(authz, id, new Set())).tags).toEqual(tags);
		} finally {
			raw.close();
		}
	});

	it("keeps the first position when merge collapses tags and rename changes spelling", async () => {
		const { raw, d1 } = migratedSqlite();
		try {
			await insertSpace(d1, { id: "space", slug: "space" });
			const service = new MemoryService(d1);
			const authz = authzFrom(testApiPrincipal());
			const created = await service.create(authz, {
				space: "space",
				title: "Merge",
				body: "",
				type: "note",
				tags: ["zulu", "middle", "alpha"],
			});
			const repo = new TagRepo(d1);
			await commitTagWrite(d1, repo.merge("zulu", "alpha", "key:kid"));
			expect((await service.get(authz, String(created.id), new Set())).tags).toEqual([
				"alpha",
				"middle",
			]);
			await commitTagWrite(d1, repo.rename("alpha", "zebra", "key:kid"));
			expect((await service.get(authz, String(created.id), new Set())).tags).toEqual([
				"zebra",
				"middle",
			]);
		} finally {
			raw.close();
		}
	});
});
