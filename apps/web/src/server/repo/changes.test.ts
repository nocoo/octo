import { describe, expect, it } from "vitest";
import { insertSpace, openTestD1 } from "./__tests__/sqlite-d1";
import { ChangeRepo } from "./changes";
import { MemoryRepo } from "./memories";

describe("ChangeRepo", () => {
	it("lists visible events, hides delete payloads, and pages by seq", async () => {
		const db = openTestD1();
		await insertSpace(db, { id: "s1", slug: "a" });
		await insertSpace(db, { id: "s2", slug: "b" });
		const memories = new MemoryRepo(db);
		await memories.write({
			id: "m1",
			spaceId: "s1",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags: [],
			actor: "key:k",
			sourceKeyId: "k",
			updatedByKeyId: "k",
			op: "create",
			now: 1,
		});
		await memories.write({
			id: "m2",
			spaceId: "s2",
			title: "t2",
			body: "b2",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags: [],
			actor: "key:k",
			sourceKeyId: "k",
			updatedByKeyId: "k",
			op: "create",
			now: 2,
		});
		await memories.trash("m1", "key:k", 3, { version: 1, spaceId: "s1" });
		const repo = new ChangeRepo(db);
		expect(await repo.head({ kind: "all" })).toBeGreaterThan(0);
		const page = await repo.list({ kind: "all" }, { limit: 1 });
		expect(page.items).toHaveLength(1);
		expect(page.next_cursor).toBeTruthy();
		const rest = await repo.list(
			{ kind: "all" },
			{ limit: 10, cursor: { s: page.items[0]?.seq ?? 0 } },
		);
		expect(rest.items.length).toBeGreaterThan(0);
		const trashed = rest.items.find((item) => item.op === "trashed");
		expect(trashed).toBeTruthy();
		if (!trashed) {
			throw new Error("expected trashed event");
		}
		const publicTrashed = repo.publicItem(trashed);
		expect(publicTrashed).not.toHaveProperty("actor");
		expect(publicTrashed).toHaveProperty("entity_id");
		const createdRow = page.items[0];
		if (!createdRow) {
			throw new Error("expected change row");
		}
		const created = repo.publicItem(createdRow);
		expect(created).toHaveProperty("actor");
		const scoped = await repo.list({ kind: "ids", ids: ["s2"] }, { limit: 50 });
		expect(scoped.items.every((item) => item.space_id === "s2")).toBe(true);
		expect((await repo.list({ kind: "ids", ids: [] }, { limit: 10 })).items).toEqual([]);
		expect((await repo.list({ kind: "all" }, { limit: 10, spaceIds: [] })).items).toEqual([]);
		expect(await repo.head({ kind: "ids", ids: [] })).toBe(0);
		expect(await repo.head({ kind: "all" }, [])).toBe(0);
		expect(await repo.head({ kind: "ids", ids: ["s1"] })).toBeGreaterThan(0);
		expect(await repo.head({ kind: "all" }, ["s2"])).toBeGreaterThan(0);
		const filtered = await repo.list({ kind: "all" }, { limit: 50, spaceIds: ["s2"] });
		expect(filtered.items.every((item) => item.space_id === "s2")).toBe(true);
	});
});
