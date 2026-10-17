import { describe, expect, it } from "vitest";
import { insertSpace, openTestD1 } from "./__tests__/sqlite-d1";
import { MemoryRepo } from "./memories";
import { diffVersions, VersionRepo, type VersionRow } from "./versions";

function row(
	over: Partial<VersionRow> & Pick<VersionRow, "version" | "body" | "title">,
): VersionRow {
	return {
		memory_id: "m1",
		type: "note",
		importance: 0.5,
		tags_json: '["infra"]',
		event_time: null,
		space_id: "s1",
		actor: "key:k",
		op: "update",
		rollback_of: null,
		created_at: 1,
		...over,
	};
}

describe("diffVersions", () => {
	it("returns field diffs, unified body, and hunks", () => {
		const from = row({
			version: 1,
			title: "old",
			body: "line1\nline2\n",
			tags_json: '["a"]',
			importance: 0.2,
		});
		const to = row({
			version: 2,
			title: "new",
			body: "line1\nline3\n",
			tags_json: '["b"]',
			importance: 0.9,
			event_time: 5,
			space_id: "s2",
			type: "log",
		});
		const diff = diffVersions(from, to);
		expect(diff.from).toBe(1);
		expect(diff.to).toBe(2);
		expect(diff.fields.map((field) => field.field).sort()).toEqual([
			"body",
			"event_time",
			"importance",
			"space_id",
			"tags",
			"title",
			"type",
		]);
		expect(diff.body.unified).toContain("-line2");
		expect(diff.body.unified).toContain("+line3");
		expect(diff.body.hunks.length).toBeGreaterThan(0);
	});

	it("handles identical snapshots and invalid tags json", () => {
		const same = row({ version: 1, title: "t", body: "b", tags_json: "nope" });
		const diff = diffVersions(same, { ...same, tags_json: "{}" });
		expect(diff.fields).toEqual([]);
		expect(diff.body.hunks).toEqual([]);
	});
});

describe("VersionRepo", () => {
	it("lists metadata and loads a snapshot", async () => {
		const db = openTestD1();
		await insertSpace(db, { id: "s1", slug: "kb-bot" });
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
		const repo = new VersionRepo(db);
		const listed = await repo.list("m1");
		expect(listed).toHaveLength(1);
		expect(listed[0]).not.toHaveProperty("body");
		const snap = await repo.get("m1", 1);
		expect(snap?.body).toBe("b");
		expect(await repo.get("m1", 9)).toBeNull();
	});
});
