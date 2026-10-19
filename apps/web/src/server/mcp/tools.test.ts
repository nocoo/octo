import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryService } from "../services/memories";
import { runDerivedTasks } from "../sync/tasks";
import { memoryInput, setup } from "./__tests__/app";

vi.mock("../sync/tasks", () => ({ runDerivedTasks: vi.fn(async () => undefined) }));

afterEach(() => vi.restoreAllMocks());

describe("MCP v1 service adapter", () => {
	it("accepts flat updates alongside nested patches with the same concurrency contract", async () => {
		const { call, flush } = await setup();
		const { id } = (await call("create_memory", memoryInput)).result.structuredContent;
		expect(
			(await call("update_memory", { id, title: "flat", importance: 0, expected_version: 1 }))
				.result.structuredContent,
		).toMatchObject({ id, title: "flat", importance: 0, version: 2 });
		expect(
			(
				await call("update_memory", {
					id,
					patch: { body: "nested", importance: 1, expected_version: 2 },
				})
			).result.structuredContent,
		).toMatchObject({ id, title: "flat", body: "nested", importance: 1, version: 3 });
		for (const args of [
			{ id, title: "stale", expected_version: 1 },
			{ id, patch: { title: "stale", expected_version: 2 } },
		])
			expect((await call("update_memory", args)).result.structuredContent).toMatchObject({
				error: { code: "version_conflict", details: { current_version: 3 } },
			});
		await flush();
	});

	it.each(["all", "spaces", "own"] as const)(
		"lists only tags with live uses in visible spaces for scope=%s",
		async (scope) => {
			const { call, sqlite, key, flush } = await setup();
			await call("create_memory", { ...memoryInput, tags: ["shared", "kb-only"] });
			await call("create_memory", { ...memoryInput, space: "dest", tags: ["shared", "dest-only"] });
			const trashed = (await call("create_memory", { ...memoryInput, tags: ["trash-only"] })).result
				.structuredContent;
			await call("delete_memory", { id: trashed.id });
			sqlite.exec(
				"INSERT INTO tags (id, name, display_name, created_at, updated_at) VALUES ('unused', 'unused', 'Unused', 1, 1)",
			);
			sqlite.prepare("UPDATE spaces SET owner_key_id = ? WHERE slug = 'kb'").run(key.row.id);
			sqlite
				.prepare("UPDATE api_keys SET scope = ?, space_ids_json = '[\"space:kb\"]' WHERE id = ?")
				.run(scope, key.row.id);
			const listed = (await call("list_tags")).result.structuredContent;
			expect(listed).toMatchObject({ next_cursor: null });
			expect(listed.items).toEqual(
				scope === "all"
					? [
							expect.objectContaining({ name: "dest-only", use_count: 1 }),
							expect.objectContaining({ name: "kb-only", use_count: 1 }),
							expect.objectContaining({ name: "shared", use_count: 2 }),
						]
					: [
							expect.objectContaining({ name: "kb-only", use_count: 1 }),
							expect.objectContaining({ name: "shared", use_count: 1 }),
						],
			);
			await flush();
		},
	);

	it.each([
		{ title: "flat", expected_version: 1, patch: { body: "nested", expected_version: 1 } },
		{ expected_version: 1, patch: { title: "nested" } },
		{ title: "flat", patch: { expected_version: 1 } },
		{ title: "flat", expected_version: 1, extra: true },
		{ patch: { title: "nested", expected_version: 1, extra: true } },
		{ patch: { title: "nested", expected_version: 1 }, extra: true },
		{ expected_version: 1 },
		{ title: "missing version" },
		{ importance: -0.1, expected_version: 1 },
		{ patch: { importance: 1.1, expected_version: 1 } },
	])("rejects invalid or mixed update forms without writes %j", async (args) => {
		const { call, db, sqlite, flush } = await setup();
		const { id } = (await call("create_memory", memoryInput)).result.structuredContent;
		await flush();
		const batch = vi.spyOn(db, "batch");
		expect((await call("update_memory", { id, ...args })).result).toMatchObject({
			isError: true,
			structuredContent: { error: { code: "validation_failed" } },
		});
		expect(batch).not.toHaveBeenCalled();
		expect(
			sqlite.prepare("SELECT version, title FROM memories WHERE id = ?").get(String(id)),
		).toEqual({
			version: 1,
			title: memoryInput.title,
		});
		await flush();
	});

	it("hides unexpected service failures and only logs fixed derived-task diagnostics", async () => {
		const { call, flush } = await setup();
		vi.spyOn(MemoryService.prototype, "get").mockRejectedValueOnce(new Error("private SQL"));
		const failed = (await call("get_memory", { id: "id" })).result;
		expect(failed.isError).toBe(true);
		expect(failed.structuredContent).toMatchObject({
			error: { code: "internal", message: "internal error" },
		});
		expect(JSON.stringify(failed)).not.toContain("private SQL");
		vi.mocked(runDerivedTasks).mockRejectedValueOnce(new Error("private upstream"));
		const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect((await call("create_memory", memoryInput)).result.isError).not.toBe(true);
		await flush();
		expect(logger).toHaveBeenCalledWith("derived_work_failed");
	});

	it("commits without an execution context and accepts omitted empty arguments", async () => {
		const { app, env, headers, rpc, flush } = await setup();
		const created = await app.request(
			"http://local/mcp",
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "create_memory", arguments: memoryInput },
				}),
			},
			env,
		);
		expect(await created.json()).toMatchObject({ result: { structuredContent: { version: 1 } } });
		expect(await (await rpc("tools/call", { name: "list_tags" })).json()).toMatchObject({
			result: { structuredContent: { items: [expect.objectContaining({ name: "mcp" })] } },
		});
		await flush();
	});
	it("executes core tools with v1 data, atomic writes and structured results", async () => {
		const { call, sqlite, flush, db } = await setup();
		const batch = vi.spyOn(db, "batch");
		const created = (await call("create_memory", memoryInput)).result;
		expect(created.isError).not.toBe(true);
		expect(created.structuredContent).toMatchObject({ ...memoryInput, version: 1 });
		expect(JSON.parse(created.content[0]?.text ?? "")).toEqual(created.structuredContent);
		const memoryBatches = batch.mock.calls.filter(([statements]) =>
			statements.some((statement) =>
				/INSERT INTO memories\s*\(/.test((statement as unknown as { sql: string }).sql),
			),
		);
		expect(memoryBatches).toHaveLength(1);
		const id = String(created.structuredContent.id);
		expect(
			sqlite.prepare("SELECT count(*) AS count FROM memory_versions WHERE memory_id = ?").get(id),
		).toMatchObject({ count: 1 });
		expect((await call("get_memory", { id })).result.structuredContent).toMatchObject({
			id,
			version: 1,
		});
		expect(
			(await call("batch_get", { ids: [id, "missing", id] })).result.structuredContent,
		).toMatchObject({ items: [{ id }], missing: ["missing"] });
		expect(
			(await call("search", { query: "octopus", mode: "fts" })).result.structuredContent,
		).toMatchObject({ items: [{ id }] });
		expect((await call("list_spaces")).result.structuredContent).toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({ slug: "kb", memory_count: 1 })]),
		});
		expect((await call("list_tags")).result.structuredContent).toMatchObject({
			items: [expect.objectContaining({ name: "mcp", use_count: 1 })],
		});
		expect(
			(await call("update_memory", { id, patch: { title: "updated", expected_version: 1 } })).result
				.structuredContent,
		).toMatchObject({ id, title: "updated", version: 2 });
		expect(
			(await call("update_memory", { id, patch: { title: "stale", expected_version: 1 } })).result
				.structuredContent,
		).toMatchObject({ error: { code: "version_conflict", details: { current_version: 2 } } });
		expect((await call("delete_memory", { id })).result.structuredContent).toMatchObject({
			trashed_at: expect.any(String),
		});
		expect((await call("get_memory", { id })).result.structuredContent).toMatchObject({
			error: { code: "not_found" },
		});
		expect(
			(
				await call("get_memory", {
					id,
					include: ["trashed", "versions_count", "attachments", "vector_status"],
				})
			).result.structuredContent,
		).toMatchObject({ id, deleted_at: expect.any(String), versions_count: 2 });
		expect(
			(await call("list_changes", { spaces: ["kb"], limit: 50 })).result.structuredContent,
		).toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({ entity_id: id, op: "trashed" })]),
			next_cursor: null,
		});
		await flush();
	});

	it.each([
		["search", { query: "octopus" }],
		["get_memory", { id: "missing" }],
		["batch_get", { ids: ["missing"] }],
		["list_changes", {}],
		["list_tags", {}],
		["list_spaces", {}],
		["create_memory", memoryInput],
		["update_memory", { id: "missing", patch: { title: "new", expected_version: 1 } }],
		["delete_memory", { id: "missing" }],
	] as const)("denies %s and audits tool errors despite HTTP 200", async (name, args) => {
		const { call, sqlite, flush, key } = await setup("");
		const result = (await call(name, args)).result;
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			error: {
				code: expect.stringMatching(/^(forbidden|not_found)$/),
				request_id: expect.any(String),
			},
		});
		await flush();
		const audit = sqlite.prepare("SELECT actor, route, status, error_code FROM audit_log").get();
		expect(audit).toMatchObject({
			actor: `key:${key.row.id}`,
			route: "/mcp",
			status: 200,
			error_code: expect.stringMatching(/^(forbidden|not_found)$/),
		});
	});

	it.each([
		["search", {}],
		["get_memory", { id: "id", extra: "no" }],
		["batch_get", { ids: [] }],
		["batch_get", { ids: Array.from({ length: 101 }, () => "id") }],
		["create_memory", { ...memoryInput, body: "中".repeat(333_334) }],
		["update_memory", { id: "id", patch: { expected_version: 1 } }],
		["update_memory", { id: "id", patch: { title: "missing version" } }],
		["delete_memory", { id: "" }],
		["list_changes", { limit: 201 }],
		["list_changes", { cursor: "bad-cursor" }],
		["list_tags", { extra: true }],
		["list_spaces", { extra: true }],
	] as const)("validates %s input before writing", async (name, args) => {
		const { call, flush, db } = await setup();
		const batch = vi.spyOn(db, "batch");
		const result = (await call(name, args)).result;
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ error: { code: "validation_failed" } });
		expect(batch).not.toHaveBeenCalled();
		await flush();
	});

	it("rolls back all staged writes and hides SQL failure details", async () => {
		const { call, sqlite, flush } = await setup();
		sqlite.exec(
			"CREATE TRIGGER fail_memory BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT, 'private-sql-secret'); END",
		);
		const result = (await call("create_memory", memoryInput)).result;
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).not.toContain("private-sql-secret");
		expect(result.structuredContent).toMatchObject({ error: { code: "unavailable" } });
		expect(sqlite.prepare("SELECT count(*) AS count FROM tags").get()).toMatchObject({ count: 0 });
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories").get()).toMatchObject({
			count: 0,
		});
		await flush();
	});
});
