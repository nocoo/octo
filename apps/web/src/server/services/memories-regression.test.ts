import { describe, expect, it, vi } from "vitest";
import { type ApiPrincipal, parseOps } from "../auth/authorize";
import { insertSpace, openTestD1 } from "../repo/__tests__/sqlite-d1";
import { MemoryRepo } from "../repo/memories";
import { TagRepo } from "../repo/tags";
import { authzFrom, MemoryService } from "./memories";

function key(over: Partial<ApiPrincipal> = {}) {
	return authzFrom({
		id: "key",
		name: "bot",
		role: "custom",
		ops: parseOps("r,w,u,d"),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
		...over,
	});
}

async function boot() {
	const db = openTestD1();
	await insertSpace(db, { id: "a", slug: "a" });
	await insertSpace(db, { id: "b", slug: "b" });
	const tags = new TagRepo(db);
	const service = new MemoryService(db, tags);
	const admin = key();
	const item = await service.create(admin, {
		space: "a",
		title: "t",
		body: "b",
		type: "note",
		tags: ["old"],
	});
	return { db, tags, service, admin, id: String(item.id) };
}

async function state(db: D1Database) {
	return Promise.all(
		["memories", "memory_versions", "memory_tags", "changes"].map(
			async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results,
		),
	);
}

describe("memory permission and rollback regressions", () => {
	it("applies delete ownership to include=trashed without hiding live reads", async () => {
		const { service, admin, id } = await boot();
		const reader = key({ id: "other", ownEntriesOnly: true });
		expect(
			(await service.list(reader, { filters: {}, include: new Set(["trashed"]), limit: 50 })).items,
		).toHaveLength(1);
		await service.remove(admin, id);
		expect(
			(await service.list(reader, { filters: {}, include: new Set(["trashed"]), limit: 50 })).items,
		).toEqual([]);
	});

	it.each(["get", "list", "diff"])(
		"binds %s history to its authorized current snapshot",
		async (operation) => {
			const { db, service, admin, id } = await boot();
			const repo = new MemoryRepo(db);
			const read = repo.get.bind(repo);
			vi.spyOn(repo, "get").mockImplementationOnce(async (memoryId) => {
				const authorized = await read(memoryId);
				await service.patch(
					admin,
					id,
					{ space: "b", body: "hidden body", title: "hidden title" },
					"1",
				);
				return authorized;
			});
			const restricted = new MemoryService(db, undefined, undefined, undefined, repo);
			const authz = key({ scope: "spaces", spaceIds: ["a"] });
			if (operation === "get")
				await expect(restricted.getVersion(authz, id, 2)).rejects.toMatchObject({
					code: "not_found",
				});
			if (operation === "list") expect(await restricted.listVersions(authz, id)).toEqual([]);
			if (operation === "diff")
				await expect(restricted.diff(authz, id, 1, 2)).rejects.toMatchObject({
					code: "unprocessable",
				});
		},
	);

	it("authorizes both spaces before rollback and preserves hidden scope", async () => {
		const { db, service, admin, id } = await boot();
		await service.patch(admin, id, { space: "b" }, "1");
		const before = await state(db);
		await expect(
			service.rollback(key({ scope: "spaces", spaceIds: ["b"] }), id, 1, "2"),
		).rejects.toMatchObject({ code: "not_found" });
		expect(await state(db)).toEqual(before);
		expect(await service.rollback(admin, id, 1, "2")).toMatchObject({ space: "a", version: 3 });
	});

	it("requires delete for single trashed reads without exposing hidden spaces", async () => {
		const { service, admin, id } = await boot();
		await service.remove(admin, id);
		await expect(
			service.get(key({ ops: parseOps("r") }), id, new Set(["trashed"])),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			service.get(
				key({ ops: parseOps("r"), scope: "spaces", spaceIds: ["b"] }),
				id,
				new Set(["trashed"]),
			),
		).rejects.toMatchObject({ code: "not_found" });
		expect(await service.get(admin, id, new Set(["trashed"]))).toMatchObject({ id });
	});

	it("does not create an own space for a key without write capability", async () => {
		const db = openTestD1();
		const service = new MemoryService(db);
		const reader = key({ scope: "own", autoOwnSpace: true, ops: parseOps("r") });
		await expect(
			service.create(reader, { space: "bot", title: "t", body: "b", type: "note", tags: [] }),
		).rejects.toMatchObject({ code: "forbidden" });
		expect((await db.prepare("SELECT * FROM spaces").all()).results).toEqual([]);
		await insertSpace(db, { id: "hidden", slug: "hidden", ownerKeyId: "other" });
		await expect(
			service.create(reader, { space: "hidden", title: "t", body: "b", type: "note", tags: [] }),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("propagates tag resolution errors without changing any memory state", async () => {
		const { db, tags, service, admin, id } = await boot();
		const before = await state(db);
		const error = new Error("D1 unavailable");
		vi.spyOn(tags, "resolveMany").mockRejectedValueOnce(error);
		await expect(service.rollback(admin, id, 1, "1")).rejects.toBe(error);
		expect(await state(db)).toEqual(before);
		await db.prepare("UPDATE memory_versions SET tags_json = 'invalid'").run();
		const corrupt = await state(db);
		await expect(service.rollback(admin, id, 1, "1")).rejects.toMatchObject({
			code: "unprocessable",
		});
		expect(await state(db)).toEqual(corrupt);
	});

	it("matches tags_all aliases and their shared canonical target", async () => {
		const { db, tags, service, admin, id } = await boot();
		await tags.resolveMany(["target"]);
		const merge = await tags.merge("old", "target", admin.actor);
		await db.batch(merge.statements);
		const listed = await service.list(admin, {
			filters: { tags_all: ["old", "target"] },
			include: new Set(),
			limit: 50,
		});
		expect(listed.items.map((item) => item.id)).toEqual([id]);
		expect(
			(
				await service.list(admin, {
					filters: { tags_all: ["missing", "target"] },
					include: new Set(),
					limit: 50,
				})
			).items,
		).toEqual([]);
	});
});
