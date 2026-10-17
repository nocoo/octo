import { describe, expect, it } from "vitest";
import { insertSpace, insertTinyProfile, openTestD1 } from "./__tests__/sqlite-d1";
import { MemoryRepo, type MemoryWrite } from "./memories";
import { resolveVectorWrite } from "./memories-vector";
import { TagRepo } from "./tags";

function writeInput(over: Partial<MemoryWrite> & Pick<MemoryWrite, "id" | "op">): MemoryWrite {
	return {
		spaceId: "s1",
		title: "t",
		body: "b",
		type: "note",
		importance: 0.5,
		eventTime: null,
		tags: [],
		actor: "key:k1",
		sourceKeyId: "k1",
		updatedByKeyId: "k1",
		now: 1,
		...over,
	};
}

async function setup() {
	const db = openTestD1();
	await insertSpace(db, { id: "s1", slug: "kb-bot" });
	await insertSpace(db, { id: "s2", slug: "other" });
	await insertTinyProfile(db);
	const tags = new TagRepo(
		db,
		() => 1,
		() => "tag1",
	);
	const resolved = await tags.resolveMany(["infra"]);
	const repo = new MemoryRepo(db);
	return { db, repo, tags: resolved };
}

describe("MemoryRepo", () => {
	it("writes a batch create with tags, fts, changes, and vector", async () => {
		const { db, repo, tags } = await setup();
		const vector = await resolveVectorWrite(db, { profile: "tiny-3", values: [1, 0, 0] });
		const row = await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "Caddy ports",
			body: "use 7059",
			type: "procedure",
			importance: 0.8,
			eventTime: Date.parse("2026-01-01T00:00:00Z"),
			tags,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "create",
			vector,
			now: 100,
		});
		expect(row.version).toBe(1);
		expect(row.space_slug).toBe("kb-bot");
		expect((await repo.tagNamesByMemory(["m1"])).get("m1")).toEqual(["infra"]);
		const fts = await db
			.prepare("SELECT fts_rowid FROM memories_fts_map WHERE memory_id = 'm1'")
			.first<{ fts_rowid: number }>();
		expect(fts?.fts_rowid).toBeGreaterThan(0);
		const match = await db
			.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'Caddy'")
			.first<{ rowid: number }>();
		expect(match?.rowid).toBe(fts?.fts_rowid);
		const change = await db
			.prepare("SELECT op, version FROM changes WHERE entity_id = 'm1'")
			.first<{ op: string; version: number }>();
		expect(change).toEqual({ op: "created", version: 1 });
		const status = await repo.vectorStatus("m1", row.content_hash);
		expect(status).toEqual([{ profile: "tiny-3", indexed: false, stale: false }]);
		expect(await repo.versionsCount("m1")).toBe(1);
		expect(await repo.attachments("m1")).toEqual([]);
	});

	it("updates with optimistic concurrency and rebuilds fts", async () => {
		const { repo, tags } = await setup();
		await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "old",
			body: "body",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "create",
			now: 1,
		});
		const updated = await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "new",
			body: "body",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags: [],
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "update",
			expectedVersion: 1,
			now: 2,
		});
		expect(updated.version).toBe(2);
		expect(updated.title).toBe("new");
		await expect(
			repo.write({
				id: "m1",
				spaceId: "s1",
				title: "x",
				body: "body",
				type: "note",
				importance: 0.5,
				eventTime: null,
				tags: [],
				actor: "key:k1",
				sourceKeyId: "k1",
				updatedByKeyId: "k1",
				op: "update",
				expectedVersion: 1,
				now: 3,
			}),
		).rejects.toMatchObject({ code: "version_conflict" });
	});

	it("trashes, lists, and restores", async () => {
		const { repo, tags } = await setup();
		await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "create",
			now: 1,
		});
		const trashed = await repo.trash("m1", "key:k1", 5);
		expect(trashed.deleted_at).toBe(5);
		const live = await repo.list({
			filters: {},
			visible: { kind: "all" },
			limit: 50,
		});
		expect(live.items).toEqual([]);
		const dumped = await repo.list({
			filters: {},
			visible: { kind: "all" },
			trashedOnly: true,
			limit: 50,
		});
		expect(dumped.items[0]?.id).toBe("m1");
		const restored = await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "restore",
			expectedVersion: 1,
			now: 6,
		});
		expect(restored.deleted_at).toBeNull();
		expect(restored.version).toBe(2);
		await expect(repo.trash("missing", "key:k1", 7)).rejects.toMatchObject({ code: "not_found" });
	});

	it("filters list by space, tags, type, time, importance, and cursor", async () => {
		const { db, repo } = await setup();
		const tags = new TagRepo(db);
		const infra = await tags.resolveMany(["infra"]);
		const ops = await tags.resolveMany(["ops"]);
		await repo.write({
			id: "a",
			spaceId: "s1",
			title: "a",
			body: "1",
			type: "note",
			importance: 0.2,
			eventTime: 10,
			tags: infra,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "create",
			now: 10,
		});
		await repo.write({
			id: "b",
			spaceId: "s2",
			title: "b",
			body: "2",
			type: "log",
			importance: 0.9,
			eventTime: 20,
			tags: ops,
			actor: "key:k2",
			sourceKeyId: "k2",
			updatedByKeyId: "k2",
			op: "create",
			now: 20,
		});
		const listed = await repo.list({
			filters: {
				types: ["note"],
				importance: { min: 0.1, max: 0.5 },
				time: {
					field: "updated",
					from: "1970-01-01T00:00:00.000Z",
					to: "1970-01-01T00:00:01.000Z",
				},
			},
			visible: { kind: "ids", ids: ["s1"] },
			tagAllIds: [infra[0]?.id ?? ""],
			tagAnyIds: [infra[0]?.id ?? ""],
			limit: 50,
		});
		expect(listed.items.map((item) => item.id)).toEqual(["a"]);
		expect(
			(
				await repo.list({
					filters: {},
					visible: { kind: "ids", ids: [] },
					limit: 1,
				})
			).items,
		).toEqual([]);
		const page = await repo.list({
			filters: {},
			visible: { kind: "all" },
			limit: 1,
		});
		expect(page.items).toHaveLength(1);
		expect(page.next_cursor).toBeTruthy();
		const rest = await repo.list({
			filters: {},
			visible: { kind: "all" },
			cursor: { u: page.items[0]?.updated_at ?? 0, i: page.items[0]?.id ?? "" },
			limit: 10,
		});
		expect(rest.items).toHaveLength(1);
		expect(rest.next_cursor).toBeNull();
		expect(
			(
				await repo.list({
					filters: { sources: ["k1"], time: { field: "event", from: "1970-01-01T00:00:00.000Z" } },
					visible: { kind: "all" },
					spaceIds: [],
					limit: 10,
				})
			).items,
		).toEqual([]);
		expect(
			(
				await repo.list({
					filters: { time: { field: "created", to: "1970-01-01T00:00:00.020Z" } },
					visible: { kind: "all" },
					tagAllIds: [],
					limit: 10,
				})
			).items,
		).toEqual([]);
		expect(await repo.spaceBySlug("kb-bot")).toMatchObject({ id: "s1" });
	});

	it("clears vectors on explicit null write", async () => {
		const { db, repo, tags } = await setup();
		const vector = await resolveVectorWrite(db, { profile: "tiny-3", values: [1, 0, 0] });
		await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "create",
			vector,
			now: 1,
		});
		await repo.write({
			id: "m1",
			spaceId: "s1",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			eventTime: null,
			tags,
			actor: "key:k1",
			sourceKeyId: "k1",
			updatedByKeyId: "k1",
			op: "update",
			expectedVersion: 1,
			vector: null,
			now: 2,
		});
		expect(await repo.vectorStatus("m1", "x")).toEqual([]);
	});

	it("lists by includeTrashed, own source, space ids, and sources", async () => {
		const { repo } = await setup();
		await repo.write(writeInput({ id: "a", op: "create", sourceKeyId: "k1", now: 10 }));
		await repo.write(
			writeInput({
				id: "b",
				op: "create",
				spaceId: "s2",
				sourceKeyId: "k2",
				now: 20,
			}),
		);
		await repo.trash("b", "key:k2", 30);
		const both = await repo.list({
			filters: {},
			visible: { kind: "all" },
			includeTrashed: true,
			limit: 50,
		});
		expect(both.items.map((item) => item.id).sort()).toEqual(["a", "b"]);
		expect(
			(
				await repo.list({
					filters: {
						sources: ["k1"],
						time: { field: "created", to: "1970-01-01T00:00:00.020Z" },
						importance: { max: 1 },
					},
					visible: { kind: "all" },
					spaceIds: ["s1"],
					ownSourceKeyId: "k1",
					limit: 50,
				})
			).items.map((item) => item.id),
		).toEqual(["a"]);
		expect(
			(
				await repo.list({
					filters: { types: [] },
					visible: { kind: "all" },
					tagAnyIds: [],
					limit: 10,
				})
			).items,
		).toEqual([]);
	});

	it("moves, rolls back, and reports attachments and indexed vectors", async () => {
		const { db, repo, tags } = await setup();
		const vector = await resolveVectorWrite(db, { profile: "tiny-3", values: [0, 1, 0] });
		await repo.write(writeInput({ id: "m1", op: "create", tags, vector, now: 1 }));
		const moved = await repo.write(
			writeInput({
				id: "m1",
				op: "move",
				spaceId: "s2",
				expectedVersion: 1,
				now: 2,
			}),
		);
		expect(moved.space_slug).toBe("other");
		const rolled = await repo.write(
			writeInput({
				id: "m1",
				op: "rollback",
				spaceId: "s1",
				rollbackOf: 1,
				expectedVersion: 2,
				now: 3,
			}),
		);
		expect(rolled.version).toBe(3);
		await db
			.prepare(
				"INSERT INTO attachments (id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at, deleted_at) VALUES ('att1', 'm1', 'r2/a', 'a.txt', 'text/plain', 1, 'aa', 'k1', 1, NULL)",
			)
			.run();
		expect(await repo.attachments("m1")).toEqual([
			{
				id: "att1",
				filename: "a.txt",
				content_type: "text/plain",
				size_bytes: 1,
				sha256: "aa",
				created_at: 1,
			},
		]);
		await db.prepare("UPDATE memory_vectors SET indexed_at = 9 WHERE memory_id = 'm1'").run();
		const hash = rolled.content_hash;
		expect(await repo.vectorStatus("m1", hash)).toEqual([
			{ profile: "tiny-3", indexed: true, stale: false },
		]);
		expect(await repo.vectorStatus("m1", "other")).toEqual([
			{ profile: "tiny-3", indexed: true, stale: true },
		]);
	});

	it("maps missing, trashed, and unique-version failures", async () => {
		const { db, repo } = await setup();
		await repo.write(writeInput({ id: "m1", op: "create", now: 1 }));
		await expect(
			repo.write(writeInput({ id: "gone", op: "update", expectedVersion: 1 })),
		).rejects.toMatchObject({ code: "not_found" });
		await repo.trash("m1", "key:k1", 2);
		await expect(
			repo.write(writeInput({ id: "m1", op: "update", expectedVersion: 1, now: 3 })),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(
			repo.write(writeInput({ id: "m1", op: "restore", expectedVersion: 9, now: 4 })),
		).rejects.toMatchObject({ code: "version_conflict" });
		await expect(
			repo.write(writeInput({ id: "x", op: "create", spaceId: "missing" })),
		).rejects.toThrow();
		await repo.write(writeInput({ id: "m2", op: "create", now: 10 }));
		await db
			.prepare(
				"INSERT INTO memory_versions (memory_id, version, title, body, type, importance, tags_json, event_time, space_id, actor, op, rollback_of, created_at) VALUES ('m2', 2, 't', 'b', 'note', 0.5, '[]', NULL, 's1', 'key:k1', 'update', NULL, 10)",
			)
			.run();
		await expect(
			repo.write(writeInput({ id: "m2", op: "update", expectedVersion: 1, now: 11 })),
		).rejects.toMatchObject({ code: "version_conflict" });
		await expect(
			repo.write(writeInput({ id: "m2", op: "update", expectedVersion: 1, now: 10 })),
		).rejects.toThrow();
	});
});
