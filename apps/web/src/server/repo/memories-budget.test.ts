import { describe, expect, it } from "vitest";
import { insertSpace, openTestD1 } from "./__tests__/sqlite-d1";
import { ChangeRepo } from "./changes";
import { MemoryRepo, type MemoryWrite } from "./memories";
import { TagRepo } from "./tags";

function input(id: string, tags: MemoryWrite["tags"] = []): MemoryWrite {
	return {
		id,
		spaceId: "s",
		title: "title",
		body: "body",
		type: "note",
		importance: 0.5,
		eventTime: null,
		tags,
		actor: "key:k",
		sourceKeyId: "k",
		updatedByKeyId: "k",
		op: "create",
		now: 1,
	};
}
async function boot() {
	const db = openTestD1();
	await insertSpace(db, { id: "s", slug: "s" });
	return { db, repo: new MemoryRepo(db) };
}

describe("D1 memory parameter budgets", () => {
	it("writes all 100 tags in the atomic memory batch", async () => {
		const { db, repo } = await boot();
		const tags = await new TagRepo(db).resolveMany(
			Array.from({ length: 100 }, (_, i) => `tag${i}`),
		);
		await repo.write(input("m", tags));
		expect((await repo.tagNamesByMemory(["m"])).get("m")).toHaveLength(100);
		expect(await repo.versionsCount("m")).toBe(1);
	});

	it("loads tags for a full 200-item page and preserves tied cursor ordering", async () => {
		const { repo } = await boot();
		for (let i = 0; i < 201; i++) {
			await repo.write(input(`m${String(i).padStart(3, "0")}`));
		}
		const first = await repo.list({ filters: {}, visible: { kind: "all" }, limit: 200 });
		expect(first.items).toHaveLength(200);
		expect(first.items[0]?.id).toBe("m200");
		expect(await repo.tagNamesByMemory(first.items.map((row) => row.id))).toEqual(new Map());
		const second = await repo.list({
			filters: {},
			visible: { kind: "all" },
			cursor: { u: 1, i: first.items[199]?.id ?? "" },
			limit: 200,
		});
		expect(second.items.map((row) => row.id)).toEqual(["m000"]);
		expect(second.next_cursor).toBeNull();
	});

	it("combines large scope and filters without splitting global pagination", async () => {
		const { db, repo } = await boot();
		const tags = await new TagRepo(db).resolveMany(Array.from({ length: 50 }, (_, i) => `tag${i}`));
		await repo.write(input("m", tags));
		const visible = {
			kind: "ids" as const,
			ids: ["s", ...Array.from({ length: 150 }, (_, i) => `scope${i}`)],
		};
		const spaceIds = ["s", ...Array.from({ length: 99 }, (_, i) => `filter${i}`)];
		const listed = await repo.list({
			visible,
			spaceIds,
			tagAllIds: tags.map((tag) => tag.id),
			tagAnyIds: tags.map((tag) => tag.id),
			filters: {
				types: ["note", ...Array.from({ length: 49 }, (_, i) => `type${i}`)],
				sources: ["k", ...Array.from({ length: 99 }, (_, i) => `source${i}`)],
				importance: { min: 0, max: 1 },
				time: { field: "updated", from: "1970-01-01T00:00:00.000Z" },
			},
			limit: 200,
		});
		expect(listed.items.map((row) => row.id)).toEqual(["m"]);
		const changes = new ChangeRepo(db);
		expect(await changes.head(visible, spaceIds)).toBe(1);
		expect(
			(await changes.list(visible, { spaceIds, limit: 200 })).items.map((row) => row.entity_id),
		).toEqual(["m"]);
	});
});
