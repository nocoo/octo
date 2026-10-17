import { describe, expect, it } from "vitest";
import { type ApiPrincipal, parseOps } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import { insertSpace, insertTinyProfile, openTestD1 } from "../repo/__tests__/sqlite-d1";
import {
	authzFrom,
	expectedVersion,
	MemoryService,
	parseInclude,
	publicMemory,
	publicVersion,
} from "./memories";

function principal(over: Partial<ApiPrincipal> = {}): ApiPrincipal {
	return {
		id: "K1",
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
	};
}

describe("authzFrom and helpers", () => {
	it("maps authorize denials and parses include/version headers", () => {
		const authz = authzFrom({
			id: "K1",
			name: "bot",
			role: "custom",
			ops: parseOps("r"),
			scope: "spaces",
			spaceIds: ["s1"],
			ownedSpaceIds: [],
			ownEntriesOnly: false,
			autoOwnSpace: false,
			expiresAt: null,
		});
		expect(authz.actor).toBe("key:K1");
		expect(authz.visible()).toEqual({ kind: "ids", ids: ["s1"] });
		authz.denyUnless("read", { spaceId: "s1" });
		expect(() => authz.denyUnless("read", { spaceId: "s2" })).toThrow(ApiError);
		expect(() => authz.denyUnless("write", { spaceId: "s1" })).toThrow(ApiError);
		expect(parseInclude(undefined).size).toBe(0);
		expect([...parseInclude("a, b")]).toEqual(["a", "b"]);
		expect(expectedVersion("3")).toBe(3);
		expect(expectedVersion('"4"', 4)).toBe(4);
		expect(() => expectedVersion("1", 2)).toThrow(ApiError);
		expect(() => expectedVersion(undefined)).toThrow(ApiError);
		const src = principal({ scope: "own" });
		const own = authzFrom(src);
		own.principal.ownedSpaceIds.push("s9");
		expect(src.ownedSpaceIds).toEqual([]);
		expect(own.visible()).toEqual({ kind: "ids", ids: ["s9"] });
	});

	it("serializes public memory and version payloads", () => {
		expect(
			publicMemory(
				{
					id: "m",
					space_id: "s",
					space_slug: "kb",
					title: "t",
					body: "b",
					type: "note",
					importance: 0.5,
					source_key_id: "k",
					updated_by_key_id: "k",
					event_time: 1,
					version: 1,
					content_hash: "h",
					created_at: 1,
					updated_at: 1,
					deleted_at: 2,
					deleted_by: "key:k",
				},
				["infra"],
			),
		).toMatchObject({ space: "kb", tags: ["infra"], deleted_by: "key:k" });
		expect(
			publicVersion(
				{
					memory_id: "m",
					version: 1,
					title: "t",
					type: "note",
					importance: 0.5,
					tags_json: "nope",
					event_time: null,
					space_id: "s",
					actor: "key:k",
					op: "create",
					rollback_of: null,
					created_at: 1,
					body: "b",
				},
				true,
			),
		).toMatchObject({ tags: [], body: "b" });
		expect(parseInclude("").size).toBe(0);
		expect([...parseInclude(",,")]).toEqual([]);
		expect(isoViaPublic()).toBeNull();
	});
});

function isoViaPublic(): unknown {
	return publicMemory(
		{
			id: "m",
			space_id: "s",
			space_slug: "kb",
			title: "t",
			body: "b",
			type: "note",
			importance: 0.5,
			source_key_id: "k",
			updated_by_key_id: "k",
			event_time: null,
			version: 1,
			content_hash: "h",
			created_at: 1,
			updated_at: 1,
			deleted_at: null,
			deleted_by: null,
		},
		[],
	).event_time;
}

describe("MemoryService", () => {
	async function boot() {
		const db = openTestD1();
		await insertSpace(db, { id: "s1", slug: "kb-bot" });
		await insertSpace(db, { id: "s2", slug: "other" });
		await insertTinyProfile(db);
		const svc = new MemoryService(
			db,
			undefined,
			() => 100,
			() => "mid1",
		);
		return { db, svc, admin: authzFrom(principal()) };
	}

	it("covers list filters, rollback tags, and forbidden heads", async () => {
		const { db, svc, admin } = await boot();
		const created = await svc.create(admin, {
			space: "kb-bot",
			title: "t",
			body: "b",
			type: "note",
			tags: ["infra", "Infra"],
		});
		expect(created.id).toBe("mid1");
		expect(
			(
				await svc.list(admin, {
					filters: { spaces: ["missing", "kb-bot"] },
					include: new Set(),
					limit: 50,
				})
			).items,
		).toHaveLength(1);
		expect(
			(
				await svc.list(admin, {
					filters: { spaces: ["nope"], tags_all: ["infra", "Infra"] },
					include: new Set(),
					limit: 50,
				})
			).items,
		).toEqual([]);
		const scoped = authzFrom(principal({ scope: "spaces", spaceIds: ["s1"] }));
		expect(
			(
				await svc.list(scoped, {
					filters: { spaces: ["other", "kb-bot"] },
					include: new Set(),
					limit: 50,
				})
			).items,
		).toHaveLength(1);
		const writer = authzFrom(principal({ ops: parseOps("w") }));
		await expect(svc.changesHead(writer)).rejects.toMatchObject({ code: "forbidden" });
		await expect(svc.listChanges(writer, { limit: 10 })).rejects.toMatchObject({
			code: "forbidden",
		});
		await expect(
			svc.list(writer, { filters: {}, include: new Set(), limit: 10 }),
		).rejects.toMatchObject({ code: "forbidden" });
		await db
			.prepare(
				"UPDATE memory_versions SET tags_json = 'nope' WHERE memory_id = 'mid1' AND version = 1",
			)
			.run();
		await expect(svc.rollback(admin, "mid1", 1, "1")).rejects.toMatchObject({
			code: "unprocessable",
		});
		await db
			.prepare(
				"INSERT INTO memory_versions (memory_id, version, title, body, type, importance, tags_json, event_time, space_id, actor, op, rollback_of, created_at) VALUES ('mid1', 9, 't', 'b', 'note', 0.5, '{}', NULL, 's1', 'key:K1', 'update', NULL, 1)",
			)
			.run();
		await expect(svc.rollback(admin, "mid1", 9, "1")).rejects.toMatchObject({
			code: "unprocessable",
		});
		const same = await svc.patch(admin, "mid1", { space: "kb-bot" }, "1");
		expect(same.space).toBe("kb-bot");
		await expect(svc.restore(admin, "mid1")).rejects.toMatchObject({ code: "not_found" });
		await expect(svc.getVersion(admin, "mid1", 99)).rejects.toMatchObject({ code: "not_found" });
		await expect(svc.diff(admin, "mid1", 1, 99)).rejects.toMatchObject({ code: "unprocessable" });
		const own = authzFrom(principal({ id: "OWN", ops: parseOps("r,d"), ownEntriesOnly: true }));
		expect(
			(
				await svc.list(own, {
					filters: {},
					include: new Set(["trashed"]),
					limit: 10,
					trashedOnly: true,
				})
			).items,
		).toEqual([]);
	});

	it("creates the auto own space on first write", async () => {
		const db = openTestD1();
		const svc = new MemoryService(db);
		const authz = authzFrom(
			principal({
				id: "Kown",
				name: "alice",
				role: "project",
				scope: "own",
				autoOwnSpace: true,
			}),
		);
		const created = await svc.create(authz, {
			space: "alice",
			title: "t",
			body: "b",
			type: "note",
			tags: [],
		});
		expect(created.space).toBe("alice");
		expect(authz.principal.ownedSpaceIds).toHaveLength(1);
		const again = await svc.create(authz, {
			space: "alice",
			title: "t2",
			body: "b2",
			type: "note",
			tags: [],
		});
		expect(again.space).toBe("alice");
	});

	it("rejects first write when the own space slug is taken", async () => {
		const db = openTestD1();
		await insertSpace(db, { id: "sTaken", slug: "alice", ownerKeyId: "other" });
		const svc = new MemoryService(db);
		const authz = authzFrom(
			principal({
				id: "Kown",
				name: "alice",
				role: "project",
				scope: "own",
				autoOwnSpace: true,
			}),
		);
		await expect(
			svc.create(authz, {
				space: "alice",
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		).rejects.toMatchObject({ code: "unprocessable" });
	});
});
