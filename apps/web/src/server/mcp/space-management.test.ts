import { afterEach, describe, expect, it, vi } from "vitest";
import { mintApiKey } from "../auth/api-key";
import { runDerivedTasks } from "../sync/tasks";
import { memoryInput, setup } from "./__tests__/app";

vi.mock("../sync/tasks", () => ({ runDerivedTasks: vi.fn(async () => undefined) }));

afterEach(() => vi.restoreAllMocks());

describe("MCP space management and moves", () => {
	it("creates, updates and deletes spaces with key-attributed changes and committed-write audit", async () => {
		const { call, sqlite, key, flush } = await setup();
		sqlite.prepare("UPDATE api_keys SET role = 'admin' WHERE id = ?").run(key.row.id);
		const created = (await call("create_space", { slug: "new-space", name: "New space" })).result;
		expect(created.isError).not.toBe(true);
		expect(created.structuredContent).toMatchObject({
			slug: "new-space",
			name: "New space",
			description: "",
			owner_key_id: null,
			memory_count: 0,
			created_at: expect.any(String),
			updated_at: expect.any(String),
		});
		const id = created.structuredContent.id;
		expect(
			(await call("update_space", { space: "new-space", name: "Renamed", description: "Details" }))
				.result.structuredContent,
		).toMatchObject({ id, slug: "new-space", name: "Renamed", description: "Details" });
		expect((await call("delete_space", { slug: "new-space" })).result.structuredContent).toEqual({
			id,
			slug: "new-space",
			deleted: true,
		});
		await flush();
		expect(
			sqlite
				.prepare("SELECT op, actor FROM changes WHERE entity_id = ? ORDER BY seq")
				.all(String(id)),
		).toEqual(["created", "updated", "deleted"].map((op) => ({ op, actor: `key:${key.row.id}` })));
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 3, errors: 0, writes: 3 });
		expect(sqlite.prepare("SELECT count(*) AS n FROM mcp_audit_writes").get()).toEqual({ n: 3 });
	});

	it.each([
		["create_space", { slug: "new-space", name: "New space" }],
		["update_space", { space: "kb", name: "Renamed" }],
		["delete_space", { slug: "kb" }],
	] as const)("requires the admin role for %s even with every operation", async (name, input) => {
		const { call, sqlite, flush } = await setup();
		expect((await call(name, input)).result).toMatchObject({
			isError: true,
			structuredContent: { error: { code: "forbidden" } },
		});
		await flush();
		expect(sqlite.prepare("SELECT error_code FROM audit_log").get()).toEqual({
			error_code: "forbidden",
		});
		expect(sqlite.prepare("SELECT count(*) AS n FROM mcp_audit_writes").get()).toEqual({ n: 0 });
	});

	it.each([
		["create_space", { slug: "new-space", name: "New space", owner_key_id: null }],
		["create_space", { slug: "Bad Slug", name: "New space" }],
		["update_space", { space: "kb" }],
		["update_space", { space: "kb", name: "Renamed", owner_key_id: "key" }],
		["update_space", { space: "kb", patch: { slug: "renamed" } }],
		["update_space", { slug: "kb", name: "Renamed" }],
		["delete_space", { slug: "kb", extra: true }],
		["move_memory", { id: "id", space: "dest", expected_version: -1 }],
		["move_memory", { id: "id", space: "dest", expected_version: 1.5 }],
		["move_memory", { id: "id", space: "dest", title: "not a move" }],
		["move_memory", { id: "id" }],
	] as const)("rejects invalid %s input before any mutation: %j", async (name, input) => {
		const { call, sqlite, db, key, flush } = await setup();
		sqlite.prepare("UPDATE api_keys SET role = 'admin' WHERE id = ?").run(key.row.id);
		const batch = vi.spyOn(db, "batch");
		expect((await call(name, input)).result).toMatchObject({
			isError: true,
			structuredContent: { error: { code: "validation_failed" } },
		});
		expect(batch).not.toHaveBeenCalled();
		await flush();
	});

	it("reports duplicate, missing and nonempty spaces without marking failed calls as writes", async () => {
		const { call, sqlite, key, flush } = await setup();
		sqlite.prepare("UPDATE api_keys SET role = 'admin' WHERE id = ?").run(key.row.id);
		expect(
			(await call("create_space", { slug: "kb", name: "Duplicate" })).result.structuredContent,
		).toMatchObject({ error: { code: "version_conflict" } });
		for (const name of ["update_space", "delete_space"])
			expect(
				(
					await call(name, {
						...(name === "update_space"
							? { space: "missing", name: "Missing" }
							: { slug: "missing" }),
					})
				).result.structuredContent,
			).toMatchObject({ error: { code: "not_found" } });
		const { id } = (await call("create_memory", memoryInput)).result.structuredContent;
		await call("delete_memory", { id });
		expect((await call("delete_space", { slug: "kb" })).result.structuredContent).toMatchObject({
			error: { code: "space_not_empty" },
		});
		await flush();
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 6, errors: 4, writes: 2 });
	});

	it("preserves omitted space fields and counts an identical committed update as a write", async () => {
		const { call, sqlite, key, flush } = await setup();
		sqlite.prepare("UPDATE api_keys SET role = 'admin' WHERE id = ?").run(key.row.id);
		await call("create_space", { slug: "details", name: "Original", description: "Keep" });
		for (let index = 0; index < 2; index++) {
			expect(
				(await call("update_space", { space: "details", name: "Renamed" })).result
					.structuredContent,
			).toMatchObject({ slug: "details", name: "Renamed", description: "Keep" });
		}
		await flush();
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 3, errors: 0, writes: 3 });
	});

	it.each([
		["create_space", { slug: "failed", name: "Failed" }],
		["update_space", { space: "kb", name: "Failed" }],
		["delete_space", { slug: "kb" }],
	] as const)(
		"rolls back failed %s transactions with a redacted unavailable error",
		async (name, input) => {
			const { call, sqlite, key, flush } = await setup();
			sqlite.prepare("UPDATE api_keys SET role = 'admin' WHERE id = ?").run(key.row.id);
			const spaces = sqlite.prepare("SELECT * FROM spaces ORDER BY id").all();
			sqlite.exec(
				"CREATE TRIGGER fail_space_change BEFORE INSERT ON changes WHEN NEW.entity = 'space' BEGIN SELECT RAISE(ABORT, 'private space failure'); END",
			);
			const result = (await call(name, input)).result;
			expect(result).toMatchObject({
				isError: true,
				structuredContent: { error: { code: "unavailable", message: "write transaction failed" } },
			});
			expect(JSON.stringify(result)).not.toContain("private space failure");
			expect(sqlite.prepare("SELECT * FROM spaces ORDER BY id").all()).toEqual(spaces);
			expect(
				sqlite.prepare("SELECT count(*) AS n FROM changes WHERE entity = 'space'").get(),
			).toEqual({ n: 0 });
			await flush();
			expect(sqlite.prepare("SELECT error_code FROM audit_log").get()).toEqual({
				error_code: "unavailable",
			});
			expect(sqlite.prepare("SELECT count(*) AS n FROM mcp_audit_writes").get()).toEqual({ n: 0 });
			expect(
				sqlite
					.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
					.get(key.row.id),
			).toEqual({ calls: 1, errors: 1, writes: 0 });
		},
	);

	it("moves through the staged memory transaction and derives stored vectors without embedding", async () => {
		const { call, sqlite, db, key, flush } = await setup();
		const created = (await call("create_memory", memoryInput)).result.structuredContent;
		await flush();
		vi.mocked(runDerivedTasks).mockClear();
		const batch = vi.spyOn(db, "batch");
		const moved = (await call("move_memory", { id: created.id, space: "dest" })).result;
		expect(moved.isError).not.toBe(true);
		expect(moved.structuredContent).toMatchObject({
			id: created.id,
			space: "dest",
			version: 2,
			tags: memoryInput.tags,
			content_hash: created.content_hash,
			source_key_id: created.source_key_id,
		});
		expect(batch).toHaveBeenCalledTimes(1);
		expect(
			sqlite
				.prepare("SELECT version, op FROM memory_versions WHERE memory_id = ? ORDER BY version")
				.all(String(created.id)),
		).toEqual([
			{ version: 1, op: "create" },
			{ version: 2, op: "move" },
		]);
		await flush();
		expect(runDerivedTasks).toHaveBeenCalledWith(
			expect.anything(),
			undefined,
			[created.id],
			undefined,
			true,
		);
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 2, errors: 0, writes: 2 });
	});

	it("validates optional versions before same-space no-ops and never counts them as writes", async () => {
		const { call, sqlite, key, flush } = await setup();
		const { id } = (await call("create_memory", memoryInput)).result.structuredContent;
		await flush();
		vi.mocked(runDerivedTasks).mockClear();
		expect((await call("move_memory", { id, space: "kb" })).result.structuredContent).toMatchObject(
			{ id, space: "kb", version: 1 },
		);
		expect(
			(await call("move_memory", { id, space: "dest", expected_version: 0 })).result
				.structuredContent,
		).toMatchObject({ error: { code: "version_conflict", details: { current_version: 1 } } });
		expect(
			(await call("move_memory", { id, space: "kb", expected_version: 2 })).result
				.structuredContent,
		).toMatchObject({ error: { code: "version_conflict" } });
		await flush();
		expect(runDerivedTasks).not.toHaveBeenCalled();
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 4, errors: 2, writes: 1 });
	});

	it("requires update on both spaces, honors own entries and hides trash", async () => {
		const { call, sqlite, db, key, flush } = await setup();
		const { id } = (await call("create_memory", memoryInput)).result.structuredContent;
		sqlite.prepare("UPDATE api_keys SET ops = 'r,w,d' WHERE id = ?").run(key.row.id);
		expect(
			(await call("move_memory", { id, space: "dest" })).result.structuredContent,
		).toMatchObject({ error: { code: "forbidden" } });
		sqlite
			.prepare(
				"UPDATE api_keys SET ops = 'r,w,u,d', scope = 'spaces', space_ids_json = '[\"space:kb\"]' WHERE id = ?",
			)
			.run(key.row.id);
		expect(
			(await call("move_memory", { id, space: "dest" })).result.structuredContent,
		).toMatchObject({ error: { code: "not_found" } });
		sqlite
			.prepare("UPDATE api_keys SET scope = 'all', own_entries_only = 1 WHERE id = ?")
			.run(key.row.id);
		const foreign = await mintApiKey(db, "mcp-test-pepper", {
			name: "foreign",
			role: "custom",
			ops: "r,w,u,d",
			scope: "all",
		});
		sqlite
			.prepare("UPDATE memories SET source_key_id = ? WHERE id = ?")
			.run(foreign.row.id, String(id));
		expect(
			(await call("move_memory", { id, space: "dest" })).result.structuredContent,
		).toMatchObject({ error: { code: "forbidden" } });
		sqlite.prepare("UPDATE api_keys SET own_entries_only = 0 WHERE id = ?").run(key.row.id);
		await call("delete_memory", { id });
		expect(
			(await call("move_memory", { id, space: "dest" })).result.structuredContent,
		).toMatchObject({ error: { code: "not_found" } });
		await flush();
	});

	it("does not audit a failed move transaction as committed or schedule derived work", async () => {
		const { call, sqlite, key, flush } = await setup();
		const { id } = (await call("create_memory", memoryInput)).result.structuredContent;
		await flush();
		vi.mocked(runDerivedTasks).mockClear();
		sqlite.exec(
			"CREATE TRIGGER fail_move BEFORE INSERT ON memory_versions WHEN NEW.op = 'move' BEGIN SELECT RAISE(ABORT, 'private move failure'); END",
		);
		const result = (await call("move_memory", { id, space: "dest", expected_version: 1 })).result;
		expect(result).toMatchObject({
			isError: true,
			structuredContent: { error: { code: "unavailable" } },
		});
		expect(JSON.stringify(result)).not.toContain("private move failure");
		expect(
			sqlite.prepare("SELECT space_id, version FROM memories WHERE id = ?").get(String(id)),
		).toEqual({ space_id: "space:kb", version: 1 });
		await flush();
		expect(runDerivedTasks).not.toHaveBeenCalled();
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 2, errors: 1, writes: 1 });
	});
});
