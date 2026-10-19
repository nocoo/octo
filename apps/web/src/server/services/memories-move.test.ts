import { describe, expect, it, vi } from "vitest";
import { type ApiPrincipal, parseOps } from "../auth/authorize";
import type { Env } from "../env";
import { insertSpace, insertTinyProfile, openTestD1 } from "../repo/__tests__/sqlite-d1";
import { searchAuthzFromPrincipal } from "../search/authz";
import { searchMemories } from "../search/service";
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
	it("rechecks current D1 space for stale vector hits and both text indexes", async () => {
		const { db, service, authz, id } = await setup();
		await db
			.prepare("UPDATE embedding_profiles SET active = CASE WHEN id = 'tiny-3' THEN 1 ELSE 0 END")
			.run();
		await service.move(authz, id, { space: "target" });
		const generation = await db
			.prepare("SELECT generation FROM vector_sync_jobs WHERE memory_id = ?")
			.bind(id)
			.first<{ generation: number }>();
		const memory = await service.get(authz, id, new Set());
		const query = vi.fn(async () => ({
			matches: [
				{
					id,
					score: 1,
					metadata: { generation: generation?.generation, content_hash: memory.content_hash },
				},
			],
		}));
		const env = { DB: db, RESOURCE_ENV: "production", VEC: { query } } as unknown as Env;
		for (const space of ["source", "target"]) {
			const key = principal({ scope: "spaces", spaceIds: [space] });
			const searchAuthz = searchAuthzFromPrincipal(key);
			for (const input of [
				{ mode: "vector" as const, vector: { profile: "tiny-3", values: [1, 0, 0] } },
				{ mode: "fts" as const, query: "preserve" },
				{ mode: "fts" as const, query: "me" },
			]) {
				const result = await searchMemories(searchAuthz, { ...input, limit: 20 }, { db, env });
				expect(result.items.map((item) => item.id)).toEqual(space === "source" ? [] : [id]);
			}
			const list = await service.list(authzFrom(key), {
				filters: {},
				include: new Set(),
				limit: 20,
			});
			expect(list.items.map((item) => item.id)).toEqual(space === "source" ? [] : [id]);
		}
		expect(query).toHaveBeenCalled();
	});

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
