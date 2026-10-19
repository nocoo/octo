import { afterEach, describe, expect, it, vi } from "vitest";
import { spyBusinessBatch } from "../../../../../tests/fixtures/business-batch";
import type { MemoryPatch } from "../../lib/schema/memory";
import { rollupUsage } from "../audit/usage";
import { setup } from "../mcp/__tests__/app";
import { insertTinyProfile } from "../repo/__tests__/sqlite-d1";
import { MemoryRepo } from "../repo/memories";
import { TagRepo } from "../repo/tags";
import * as derivedTasks from "../sync/tasks";
import { testApiPrincipal } from "../test-principal";
import { BatchMemoryService } from "./batch-memories";
import { authzFrom, MemoryService } from "./memories";

const databases: Awaited<ReturnType<typeof setup>>["sqlite"][] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const db of databases.splice(0)) db.close();
});

const input = {
	space: "kb",
	title: "No-op contract",
	body: "Preserve this memory",
	type: "note" as const,
	tags: ["Zulu", "Alpha"],
	importance: 0,
	event_time: "2026-10-18T00:00:00Z",
};

async function fixture(vector = false) {
	const context = await setup();
	databases.push(context.sqlite);
	await insertTinyProfile(context.db);
	const authz = authzFrom(testApiPrincipal(context.key.row.id));
	const service = new MemoryService(context.db);
	const created = await service.create(authz, {
		...input,
		...(vector ? { vector: { profile: "tiny-3", values: [0, 3, 4] } } : {}),
	});
	const id = String(created.id);
	const snapshot = () =>
		[
			"memories",
			"memory_versions",
			"memory_tags",
			"tags",
			"memories_fts",
			"memories_fts_map",
			"changes",
			"memory_vectors",
			"vector_sync_jobs",
			"settings",
		].map((table) => context.sqlite.prepare(`SELECT * FROM ${table}`).all());
	const request = (path: string, body: unknown, headers = {}) =>
		context.app.request(
			`/api/v1${path}`,
			{
				method: path.includes("batch") ? "POST" : "PATCH",
				headers: { ...context.headers, ...headers },
				body: JSON.stringify(body),
			},
			context.env,
			context.ctx,
		);
	return { ...context, authz, service, created, id, snapshot, request };
}

describe("memory no-op updates", () => {
	it.each<MemoryPatch>([
		{ space: "kb" },
		{ title: input.title },
		{ body: input.body },
		{ type: "note" },
		{ importance: 0 },
		{ event_time: "2026-10-18T00:00:00.000Z" },
		{ tags: [" ＺＵＬＵ ", "alpha", "Zulu"] },
		{ vector: null },
		{ ...input, tags: ["zulu", "ALPHA", "alpha"] },
	])("returns the existing resource without executing writes for %j", async (patch) => {
		const { db, service, authz, created, id, snapshot } = await fixture();
		const before = snapshot();
		const prepare = vi.spyOn(db, "prepare");
		const batch = spyBusinessBatch(db);
		expect(await service.patch(authz, id, patch, "1")).toEqual(created);
		expect(batch).not.toHaveBeenCalled();
		expect(
			prepare.mock.calls
				.map(([sql]) => sql)
				.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)),
		).toEqual([]);
		expect(snapshot()).toEqual(before);
	});

	it("compares normalized vectors, including an omitted or unchanged vector", async () => {
		const { db, service, authz, created, id, snapshot } = await fixture(true);
		const before = snapshot();
		const batch = spyBusinessBatch(db);
		for (const patch of [
			{ title: input.title },
			{ vector: { profile: "tiny-3", values: [0, 6, 8] } },
		]) {
			expect(await service.patch(authz, id, patch, "1")).toEqual(created);
		}
		expect(batch).not.toHaveBeenCalled();
		expect(snapshot()).toEqual(before);
	});

	it("follows tag aliases and preserves ordered first occurrences", async () => {
		const { db, service, authz, id, snapshot } = await fixture();
		const tags = new TagRepo(db);
		await tags.resolveMany(["old-zulu"]);
		await db.batch((await tags.merge("old-zulu", "zulu", authz.actor)).statements);
		const current = await service.get(authz, id, new Set());
		const before = snapshot();
		expect(await service.patch(authz, id, { tags: ["old-zulu", "ZULU", "alpha"] }, "1")).toEqual(
			current,
		);
		expect(snapshot()).toEqual(before);
	});

	it.each<MemoryPatch>([
		{ space: "dest" },
		{ title: "Changed" },
		{ body: "" },
		{ type: "fact" },
		{ importance: 1 },
		{ event_time: null },
		{ tags: ["alpha", "zulu"] },
		{ tags: [] },
		{ tags: ["new"] },
		{ vector: { profile: "tiny-3", values: [1, 0, 0] } },
	])("still versions an effective change %j", async (patch) => {
		const { service, authz, id, sqlite } = await fixture();
		expect(await service.patch(authz, id, patch, "1")).toMatchObject({ version: 2 });
		expect(sqlite.prepare("SELECT count(*) AS n FROM memory_versions").get()).toEqual({ n: 2 });
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM changes WHERE entity = 'memory'").get(),
		).toEqual({ n: patch.space ? 3 : 2 });
	});

	it("does not treat vector removal or a stale stored embedding as unchanged", async () => {
		const { service, authz, id, db } = await fixture(true);
		await db
			.prepare("UPDATE memory_vectors SET content_hash = 'stale' WHERE memory_id = ?")
			.bind(id)
			.run();
		expect(
			await service.patch(authz, id, { vector: { profile: "tiny-3", values: [0, 3, 4] } }, "1"),
		).toMatchObject({ version: 2 });
		expect(await service.patch(authz, id, { vector: null }, "2")).toMatchObject({ version: 3 });
		expect(await service.patch(authz, id, { vector: null }, "3")).toMatchObject({ version: 3 });
	});

	it.each(["embedding_model = 'old-model'", "dim = 4", "vector = X'00000000'"])(
		"refreshes vector metadata or data that differs: %s",
		async (assignment) => {
			const { service, authz, id, db } = await fixture(true);
			await db
				.prepare(`UPDATE memory_vectors SET ${assignment} WHERE memory_id = ?`)
				.bind(id)
				.run();
			expect(
				await service.patch(authz, id, { vector: { profile: "tiny-3", values: [0, 3, 4] } }, "1"),
			).toMatchObject({ version: 2 });
		},
	);

	it("checks optimistic versions and permissions before accepting no-ops", async () => {
		const { service, authz, id, created } = await fixture();
		await expect(service.patch(authz, id, { title: input.title }, "9")).rejects.toMatchObject({
			code: "version_conflict",
			details: { current_version: 1 },
		});
		const reader = authzFrom({ ...authz.principal, ops: new Set(["r"] as const) });
		await expect(service.patch(reader, id, { title: input.title }, "1")).rejects.toMatchObject({
			code: "forbidden",
		});
		expect(await service.get(authz, id, new Set())).toEqual(created);
	});

	it("rechecks the version when a matching patch races a concurrent move", async () => {
		const { service, authz, id, db } = await fixture();
		const repo = new MemoryRepo(db);
		const get = repo.get.bind(repo);
		vi.spyOn(repo, "get").mockImplementationOnce(async (memoryId) => {
			const current = await get(memoryId);
			await service.patch(authz, id, { space: "dest" }, "1");
			return current;
		});
		const raced = new MemoryService(db, undefined, undefined, undefined, repo);
		await expect(raced.patch(authz, id, { title: input.title }, "1")).rejects.toMatchObject({
			code: "version_conflict",
			details: { current_version: 2 },
		});
	});

	it("recognizes empty tags, an empty body and a null event time as unchanged", async () => {
		const { service, authz, id, snapshot } = await fixture();
		const patch = { tags: [], body: "", event_time: null };
		const current = await service.patch(authz, id, patch, "1");
		const before = snapshot();
		expect(await service.patch(authz, id, patch, "2")).toEqual(current);
		expect(snapshot()).toEqual(before);
	});

	it("does not mark MCP no-ops as committed writes or schedule derived tasks", async () => {
		const { call, id, created, db, sqlite, key, flush, snapshot } = await fixture();
		const before = snapshot();
		const derived = vi.spyOn(derivedTasks, "runDerivedTasks");
		for (const args of [
			{ id, ...input, vector: null, expected_version: 1 },
			{ id, patch: { tags: ["ZULU", "alpha", "Alpha"], expected_version: 1 } },
		]) {
			const result = (await call("update_memory", args)).result;
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent).toEqual(created);
		}
		await flush();
		expect(snapshot()).toEqual(before);
		expect(derived).not.toHaveBeenCalled();
		expect(sqlite.prepare("SELECT count(*) AS n FROM mcp_audit_writes").get()).toEqual({ n: 0 });
		await rollupUsage(db);
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 2, errors: 0, writes: 0 });
	});

	it("keeps PATCH and flat/nested MCP no-ops free of derived writes", async () => {
		const { request, call, id, created, snapshot, flush } = await fixture(true);
		const before = snapshot();
		const derived = vi.spyOn(derivedTasks, "runDerivedTasks");
		const response = await request(`/memories/${id}`, {
			...input,
			vector: { profile: "tiny-3", values: [0, 6, 8] },
			expected_version: 1,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(created);
		await flush();
		expect(snapshot()).toEqual(before);
		for (const args of [
			{ id, title: input.title, expected_version: 1 },
			{ id, patch: { tags: ["ZULU", "alpha", "Alpha"], expected_version: 1 } },
		]) {
			const result = (await call("update_memory", args)).result;
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent).toEqual(created);
		}
		const stale = (await call("update_memory", { id, title: input.title, expected_version: 9 }))
			.result;
		expect(stale).toMatchObject({
			isError: true,
			structuredContent: { error: { code: "version_conflict", details: { current_version: 1 } } },
		});
		expect(
			(await request(`/memories/${id}`, { title: input.title, expected_version: 9 })).status,
		).toBe(409);
		await flush();
		expect(snapshot()).toEqual(before);
		expect(derived).not.toHaveBeenCalled();
	});

	it("rolls back staged tag and vector state before evaluating duplicate IDs again", async () => {
		const { db, authz, id, created, snapshot } = await fixture(true);
		const batch = new BatchMemoryService();
		const ctx = { db, principal: authz.principal, statements: [] as D1PreparedStatement[] };
		const before = snapshot();
		const rollback = batch.checkpoint(ctx);
		await batch.update(
			id,
			{
				tags: ["transient"],
				vector: { profile: "tiny-3", values: [1, 0, 0] },
				expected_version: 1,
			},
			ctx,
		);
		expect(ctx.statements.length).toBeGreaterThan(0);
		rollback();
		expect(ctx.statements).toEqual([]);
		expect(
			await batch.update(
				id,
				{
					tags: ["ZULU", "alpha"],
					vector: { profile: "tiny-3", values: [0, 6, 8] },
					expected_version: 1,
				},
				ctx,
			),
		).toMatchObject(created);
		expect(ctx.statements).toEqual([]);
		expect(snapshot()).toEqual(before);
	});

	it("keeps batch no-ops at the staged version and normalized vector state", async () => {
		const { request, id, created, snapshot, flush, sqlite } = await fixture(true);
		const before = snapshot();
		const allNoops = await request("/memories:batchUpdate", {
			items: [
				{ id, title: input.title, expected_version: 1 },
				{ id, patch: { tags: ["ZULU", "alpha"], expected_version: 1 } },
			],
		});
		expect(await allNoops.json()).toMatchObject({
			results: [
				{ ok: true, item: created },
				{ ok: true, item: created },
			],
		});
		await flush();
		expect(snapshot()).toEqual(before);
		const mixed = await request("/memories:batchUpdate", {
			items: [
				{ id, vector: { profile: "tiny-3", values: [1, 0, 0] }, expected_version: 1 },
				{ id, patch: { vector: { profile: "tiny-3", values: [2, 0, 0] }, expected_version: 2 } },
				{ id, title: input.title, expected_version: 1 },
				{ id, vector: null, expected_version: 2 },
				{ id, patch: { vector: null, expected_version: 3 } },
				{ id, tags: ["alpha", "zulu"], expected_version: 3 },
				{ id, tags: ["ALPHA", "zulu", "alpha"], expected_version: 4 },
				{ id, tags: ["new-tag"], expected_version: 4 },
				{ id, patch: { tags: ["ＮＥＷ－ＴＡＧ", "new-tag"], expected_version: 5 } },
			],
		});
		expect(await mixed.json()).toMatchObject({
			results: [
				{ ok: true, item: { version: 2 } },
				{ ok: true, item: { version: 2 } },
				{ ok: false, error: { code: "version_conflict", details: { current_version: 2 } } },
				{ ok: true, item: { version: 3 } },
				{ ok: true, item: { version: 3 } },
				{ ok: true, item: { version: 4, tags: ["alpha", "zulu"] } },
				{ ok: true, item: { version: 4, tags: ["alpha", "zulu"] } },
				{ ok: true, item: { version: 5, tags: ["new-tag"] } },
				{ ok: true, item: { version: 5, tags: ["new-tag"] } },
			],
		});
		await flush();
		expect(sqlite.prepare("SELECT count(*) AS n FROM memory_versions").get()).toEqual({ n: 5 });
	});
});
