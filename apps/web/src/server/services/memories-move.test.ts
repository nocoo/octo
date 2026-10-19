import { describe, expect, it } from "vitest";
import { type ApiPrincipal, parseOps } from "../auth/authorize";
import { insertSpace, insertTinyProfile, openTestD1 } from "../repo/__tests__/sqlite-d1";
import { authzFrom, MemoryService } from "./memories";

function principal(overrides: Partial<ApiPrincipal> = {}): ApiPrincipal {
	return {
		id: "mover",
		name: "mover",
		role: "custom",
		ops: parseOps("r,w,u,d"),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
		...overrides,
	};
}

async function setup() {
	const db = openTestD1();
	await insertSpace(db, { id: "source", slug: "source" });
	await insertSpace(db, { id: "target", slug: "target" });
	await insertTinyProfile(db);
	const service = new MemoryService(db);
	const authz = authzFrom(principal());
	const item = await service.create(authz, {
		space: "source",
		title: "move me",
		body: "preserve this",
		type: "note",
		tags: ["second", "first"],
		importance: 0.5,
		vector: { profile: "tiny-3", values: [1, 0, 0] },
	});
	return { db, service, authz, id: String(item.id) };
}

describe("memory moves", () => {
	it("preserves content, vectors and history and emits source tombstone plus destination event", async () => {
		const { db, service, authz, id } = await setup();
		const before = await db
			.prepare("SELECT * FROM memory_vectors WHERE memory_id = ?")
			.bind(id)
			.first();
		const head = await service.changesHead(authz);
		const moved = await service.move(authz, id, { space: "target" });
		expect(moved).toMatchObject({
			id,
			space: "target",
			version: 2,
			tags: ["second", "first"],
			body: "preserve this",
		});
		expect(
			await db.prepare("SELECT * FROM memory_vectors WHERE memory_id = ?").bind(id).first(),
		).toEqual(before);
		expect((await service.listVersions(authz, id)).map((version) => version.op)).toEqual([
			"create",
			"move",
		]);
		const old = authzFrom(principal({ scope: "spaces", spaceIds: ["source"] }));
		await expect(service.get(old, id, new Set())).rejects.toMatchObject({ code: "not_found" });
		expect((await service.listChanges(old, { cursor: head.cursor, limit: 50 })).items).toEqual([
			expect.objectContaining({ entity_id: id, op: "moved_out" }),
		]);
		const sourceEvent = (await service.listChanges(old, { cursor: head.cursor, limit: 50 }))
			.items[0];
		expect(sourceEvent).not.toHaveProperty("space_id");
		expect(sourceEvent).not.toHaveProperty("actor");
		const target = authzFrom(principal({ scope: "spaces", spaceIds: ["target"] }));
		expect((await service.listChanges(target, { cursor: head.cursor, limit: 50 })).items).toEqual([
			expect.objectContaining({ entity_id: id, op: "moved", space_id: "target", version: 2 }),
		]);
	});
	it("requires update on both spaces and respects own-entry restrictions before version errors", async () => {
		const { service, authz, id } = await setup();
		for (const overrides of [
			{ scope: "spaces" as const, spaceIds: ["source"] },
			{ scope: "spaces" as const, spaceIds: ["target"] },
		]) {
			await expect(
				service.move(authzFrom(principal(overrides)), id, { space: "target", expected_version: 0 }),
			).rejects.toMatchObject({ code: "not_found" });
		}
		for (const overrides of [{ ops: parseOps("r,w") }, { id: "other", ownEntriesOnly: true }]) {
			await expect(
				service.move(authzFrom(principal(overrides)), id, { space: "target" }),
			).rejects.toMatchObject({ code: "forbidden" });
		}
		await expect(service.move(authz, id, { space: "missing" })).rejects.toMatchObject({
			code: "not_found",
		});
		await expect(service.move(authz, id, { space: "target" }, '"0"')).rejects.toMatchObject({
			code: "version_conflict",
		});
		await expect(
			service.move(authz, id, { space: "target", expected_version: 0 }),
		).rejects.toMatchObject({ code: "version_conflict" });
		await expect(service.move(authz, id, { space: "target" }, "bad")).rejects.toMatchObject({
			code: "validation_failed",
		});
		await expect(
			service.move(authz, id, { space: "target", expected_version: 2 }, "1"),
		).rejects.toMatchObject({ code: "validation_failed" });
		expect(await service.move(authz, id, { space: "source", expected_version: 1 })).toMatchObject({
			version: 1,
		});
		expect(
			await service.move(authzFrom(principal({ ops: parseOps("u") })), id, {
				space: "target",
				expected_version: 1,
			}),
		).toMatchObject({ version: 2 });
		await service.remove(authz, id);
		await expect(service.move(authz, id, { space: "source" })).rejects.toMatchObject({
			code: "not_found",
		});
	});
});
