import { describe, expect, it, vi } from "vitest";
import { insertSpace, insertTinyProfile, openTestD1 } from "./__tests__/sqlite-d1";
import { MemoryRepo, type MemoryWrite } from "./memories";
import { resolveVectorWrite } from "./memories-vector";

function input(over: Partial<MemoryWrite> = {}): MemoryWrite {
	return {
		id: "m",
		spaceId: "a",
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
		...over,
	};
}
async function boot() {
	const db = openTestD1();
	await insertSpace(db, { id: "a", slug: "a" });
	await insertSpace(db, { id: "b", slug: "b" });
	await insertTinyProfile(db);
	const repo = new MemoryRepo(db);
	await repo.write(
		input({ vector: await resolveVectorWrite(db, { profile: "tiny-3", values: [1, 0, 0] }) }),
	);
	return { db, repo };
}
async function state(db: D1Database) {
	return Promise.all(
		["memories", "memory_versions", "memory_tags", "memories_fts", "changes", "memory_vectors"].map(
			async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results,
		),
	);
}

describe("memory transition atomicity", () => {
	it("does not append events on repeated trash in the same millisecond", async () => {
		const { db, repo } = await boot();
		await repo.trash("m", "key:k", 2, { version: 1, spaceId: "a" });
		const before = await state(db);
		await expect(repo.trash("m", "key:k", 2, { version: 1, spaceId: "a" })).rejects.toMatchObject({
			code: "not_found",
		});
		expect(await state(db)).toEqual(before);
	});

	it("rejects trash after an authorized row moves away", async () => {
		const { db, repo } = await boot();
		await repo.write(input({ op: "move", spaceId: "b", expectedVersion: 1, now: 2 }));
		const before = await state(db);
		await expect(repo.trash("m", "key:k", 3, { version: 1, spaceId: "a" })).rejects.toMatchObject({
			code: "version_conflict",
		});
		expect(await state(db)).toEqual(before);
	});

	it("propagates unrelated batch failures and reports genuine version conflicts", async () => {
		const { db, repo } = await boot();
		const error = new Error("storage unavailable");
		vi.spyOn(db, "batch").mockRejectedValueOnce(error);
		const before = await state(db);
		await expect(repo.write(input({ op: "update", expectedVersion: 1, now: 2 }))).rejects.toBe(
			error,
		);
		expect(await state(db)).toEqual(before);
		await repo.write(input({ op: "update", expectedVersion: 1, now: 2 }));
		await expect(
			repo.write(input({ op: "update", expectedVersion: 1, now: 2 })),
		).rejects.toMatchObject({ code: "version_conflict" });
	});

	it("marks retained vectors pending on move and restore without changing their contents", async () => {
		const { db, repo } = await boot();
		await db.prepare("UPDATE memory_vectors SET indexed_at = 10").run();
		await repo.write(input({ op: "move", spaceId: "b", expectedVersion: 1, now: 2 }));
		expect(
			(await repo.vectorStatus("m", (await repo.get("m"))?.content_hash ?? ""))[0],
		).toMatchObject({ indexed: false, stale: false });
		await db.prepare("UPDATE memory_vectors SET indexed_at = 10").run();
		const vector = await db.prepare("SELECT vector, content_hash FROM memory_vectors").first();
		await repo.trash("m", "key:k", 3, { version: 2, spaceId: "b" });
		await repo.write(input({ op: "restore", spaceId: "b", expectedVersion: 2, now: 4 }));
		expect(
			(await repo.vectorStatus("m", (await repo.get("m"))?.content_hash ?? ""))[0]?.indexed,
		).toBe(false);
		expect(await db.prepare("SELECT vector, content_hash FROM memory_vectors").first()).toEqual(
			vector,
		);
	});
});
