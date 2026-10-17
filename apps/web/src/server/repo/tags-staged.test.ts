import { describe, expect, it } from "vitest";
import { openTestD1 } from "./__tests__/sqlite-d1";
import { TagRepo } from "./tags";

describe("staged tag resolution", () => {
	it("deduplicates pending names and forgets rolled-back item inserts", async () => {
		const db = openTestD1();
		const statements: D1PreparedStatement[] = [];
		const tags = new TagRepo(db, undefined, undefined, statements);
		const first = await tags.resolveMany(["Alpha", "alpha"]);
		expect(first).toHaveLength(1);
		expect(await tags.getById(first[0]?.id ?? "")).toEqual(first[0]);
		expect(await tags.resolveMany(["alpha"])).toEqual(first);
		expect(statements).toHaveLength(1);
		expect((await db.prepare("SELECT * FROM tags").all()).results).toEqual([]);
		statements.length = 0;
		expect(await tags.getById(first[0]?.id ?? "")).toBeNull();
		const second = await tags.resolveMany(["alpha"]);
		expect(second[0]?.id).not.toBe(first[0]?.id);
		await db.batch(statements);
		expect(await tags.resolveMany(["alpha"])).toEqual(second);
		expect(statements).toHaveLength(1);
	});

	it("follows existing aliases without staging a duplicate", async () => {
		const db = openTestD1();
		const immediate = new TagRepo(db);
		await immediate.resolveMany(["alpha", "beta"]);
		await db.batch((await immediate.merge("alpha", "beta", "key:admin")).statements);
		const statements: D1PreparedStatement[] = [];
		const tags = new TagRepo(db, undefined, undefined, statements);
		expect((await tags.resolveMany(["alpha", "beta"])).map((tag) => tag.name)).toEqual(["beta"]);
		expect(statements).toEqual([]);
	});
});
