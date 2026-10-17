import { describe, expect, it, vi } from "vitest";
import { parseOps } from "../auth/authorize";
import { insertSpace, insertTinyProfile, openTestD1 } from "../repo/__tests__/sqlite-d1";
import { MemoryRepo, type MemoryWrite } from "../repo/memories";
import { resolveVectorWrite } from "../repo/memories-vector";
import { TagRepo } from "../repo/tags";
import { authzFrom, MemoryService } from "./memories";

async function state(db: D1Database) {
	return Promise.all([
		...[
			"memories",
			"memory_versions",
			"tags",
			"memory_tags",
			"memories_fts",
			"memories_fts_map",
			"changes",
			"memory_vectors",
		].map(async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results),
		...["original", "attacker"].map(
			async (word) =>
				(
					await db
						.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?")
						.bind(word)
						.all()
				).results,
		),
	]);
}

async function boot() {
	const db = openTestD1();
	await insertSpace(db, { id: "a", slug: "a" });
	await insertSpace(db, { id: "b", slug: "b" });
	await insertTinyProfile(db);
	const tags = new TagRepo(db);
	const repo = new MemoryRepo(db);
	const original: MemoryWrite = {
		id: "m",
		spaceId: "a",
		title: "original",
		body: "original",
		type: "note",
		importance: 0.5,
		eventTime: null,
		tags: await tags.resolveMany(["original"]),
		actor: "key:k",
		sourceKeyId: "k",
		updatedByKeyId: "k",
		op: "create",
		now: 100,
		vector: await resolveVectorWrite(db, { profile: "tiny-3", values: [1, 0, 0] }),
	};
	await repo.write(original);
	const service = new MemoryService(
		db,
		tags,
		() => 100,
		() => "unused",
		repo,
	);
	const scoped = authzFrom({
		id: "k",
		name: "k",
		role: "custom",
		ops: parseOps("r,w,u,d"),
		scope: "spaces",
		spaceIds: ["a"],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	});
	return { db, repo, tags, original, service, scoped };
}

describe("authorized memory version binding", () => {
	for (const operation of ["patch", "rollback"] as const) {
		it(`${operation} rejects future versions before resolving tags`, async () => {
			const { db, repo, tags, service, scoped } = await boot();
			const resolve = vi.spyOn(tags, "resolveMany");
			const write = vi.spyOn(repo, "write");
			const before = await state(db);
			const pending =
				operation === "patch"
					? service.patch(scoped, "m", { tags: ["attacker"] }, "2")
					: service.rollback(scoped, "m", 1, "2");
			await expect(pending).rejects.toMatchObject({
				code: "version_conflict",
				details: { current_version: 1 },
			});
			expect(resolve).not.toHaveBeenCalled();
			expect(write).not.toHaveBeenCalled();
			expect(await state(db)).toEqual(before);
		});

		it(`${operation} cannot write after its authorized version moves into a hidden space`, async () => {
			const { db, repo, original, service, scoped } = await boot();
			const write = repo.write.bind(repo);
			let movedState: Awaited<ReturnType<typeof state>> | undefined;
			vi.spyOn(repo, "write").mockImplementationOnce(async (input) => {
				expect(input.expectedVersion).toBe(1);
				await write({ ...original, op: "move", spaceId: "b", expectedVersion: 1 });
				movedState = await state(db);
				return write(input);
			});
			const pending =
				operation === "patch"
					? service.patch(scoped, "m", { title: "attacker", tags: ["original"] }, "1")
					: service.rollback(scoped, "m", 1, "1");
			await expect(pending).rejects.toMatchObject({
				code: "version_conflict",
				details: { current_version: 2 },
			});
			expect(movedState).toBeDefined();
			expect(await state(db)).toEqual(movedState);
			expect(await repo.get("m")).toMatchObject({ space_id: "b", version: 2, title: "original" });
		});
	}
});
