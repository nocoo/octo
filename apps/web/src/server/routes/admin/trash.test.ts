import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { auditMiddleware } from "../../audit/middleware";
import { adminWriteOriginMiddleware } from "../../auth/origin";
import type { AppVars, Env } from "../../env";
import { encodeCursor } from "../../http/cursor";
import { toErrorResponse } from "../../lib/errors";
import { accessMiddleware } from "../../middleware/access";
import { createAdminPurgeRoutes } from "./purge";

const stores: ReturnType<typeof sqliteD1>[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.sqlite.close();
	vi.restoreAllMocks();
});

function fixture() {
	const store = sqliteD1();
	stores.push(store);
	const { db, sqlite } = store;
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((error) => toErrorResponse(error, "trash-test"));
	app.use("*", auditMiddleware);
	app.use("/api/admin/*", accessMiddleware, adminWriteOriginMiddleware);
	app.route("/api/admin", createAdminPurgeRoutes());
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (task: Promise<unknown>) => pending.push(task),
	} as unknown as ExecutionContext;
	const files = { delete: vi.fn().mockResolvedValue(undefined) };
	const env = {
		DB: db,
		FILES: files,
		API_KEY_PEPPER: "test-pepper",
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "trash@local",
	} as unknown as Env;
	function seed(id: string, title = "selected", space = "space:kb", trashed = true) {
		sqlite
			.prepare(`INSERT INTO memories
			(id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at,deleted_at)
			VALUES (?, ?, ?, 'body', 'note', 'source', 'hash', 1, 1, ?)`)
			.run(id, space, title, trashed ? 2 : null);
		sqlite
			.prepare(
				"INSERT INTO changes(entity,entity_id,space_id,op,actor,at) VALUES ('memory', ?, ?, 'trashed', 'admin:trash@local', 2)",
			)
			.run(id, space);
	}
	async function request(path = "/trash", body?: unknown, origin = "https://octo.dev.hexly.ai") {
		const response = await app.request(
			`http://localhost/api/admin${path}`,
			{
				method: body === undefined ? "GET" : "POST",
				headers: { Origin: origin, "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			env,
			ctx,
		);
		const data = (await response.json()) as {
			items: Array<{ id: string }>;
			total: number;
			next_cursor: string | null;
			purged: number;
			remaining: number;
		};
		await Promise.all(pending.splice(0));
		return { status: response.status, data };
	}
	return { ...store, app, env, files, seed, request };
}

describe("admin trash batch and snapshot paging", () => {
	it("restores a maximum batch with many tags in a bounded number of D1 calls", async () => {
		const f = fixture();
		for (let t = 0; t < 100; t++)
			f.sqlite
				.prepare(
					"INSERT INTO tags(id,name,display_name,created_at,updated_at) VALUES (?, ?, ?,1,1)",
				)
				.run(`tag${t}`, `tag${t}`, `tag${t}`);
		const ids = Array.from({ length: 100 }, (_, i) => `m${i}`);
		for (const id of ids) {
			f.seed(id);
			f.sqlite.prepare("INSERT INTO memory_tags(memory_id,tag_id) SELECT ?,id FROM tags").run(id);
		}
		const calls = vi.spyOn(f.db, "prepare");
		expect((await f.request("/trash:batchRestore", { ids })).data).toMatchObject({
			succeeded: 100,
			failed: 0,
		});
		// D1 batches count as one binding call; tag reads must not scale with tag count.
		const reads = calls.mock.calls.filter(([sql]) => sql.startsWith("SELECT"));
		expect(reads.length).toBeLessThan(500);
	});
	it("lists filtered literal title/tag substrings, not bodies, with accurate totals", async () => {
		const f = fixture();
		f.seed("a", "100%_Match");
		f.seed("b", "100xxMatch");
		f.seed("c", "other");
		f.seed("d", "%_match", "space:kb", false);
		f.sqlite.exec(
			"INSERT INTO tags(id,name,display_name,created_at,updated_at) VALUES ('tag','%_match','%_match',1,1); INSERT INTO memory_tags(memory_id,tag_id) VALUES ('c','tag')",
		);
		const listed = await f.request("/trash?q=%25_match&space=kb&limit=1");
		expect(listed.status).toBe(200);
		expect(listed.data).toMatchObject({
			total: 2,
			items: [{ id: "c", tags: ["%_match"] }],
			next_cursor: expect.any(String),
		});
		const next = await f.request(
			`/trash?q=%25_match&space=kb&limit=1&cursor=${listed.data.next_cursor}`,
		);
		expect(next.data).toMatchObject({ total: 2, items: [{ id: "a" }], next_cursor: null });
		expect((await f.request("/trash?q=body")).data.total).toBe(0);
		expect((await f.request("/trash?space=missing")).data.total).toBe(0);
	});

	it("returns listing metadata without loading large memory bodies", async () => {
		const f = fixture();
		f.seed("large");
		f.sqlite.prepare("UPDATE memories SET body=? WHERE id='large'").run("body".repeat(250_000));
		const calls = vi.spyOn(f.db, "prepare");
		const result = await f.request("/trash?limit=200");
		expect(Object.keys(result.data.items[0] ?? {}).includes("body")).toBe(false);
		expect(calls.mock.calls.some(([sql]) => /SELECT m\.\*/.test(sql))).toBe(false);
	});

	it.each([
		"limit=0",
		"limit=201",
		"limit=1.5",
		"limit=x",
		"q=x&q=y",
		"unknown=x",
		"cursor=bad",
		"space=",
		`q=${"x".repeat(501)}`,
	])("strictly rejects query %s", async (query) => {
		expect((await fixture().request(`/trash?${query}`)).status).toBe(400);
	});

	it("defaults to 25 and binds signed paging to filters without absorbing new trash", async () => {
		const f = fixture();
		for (let i = 0; i < 27; i++) f.seed(`m${String(i).padStart(2, "0")}`);
		const first = (await f.request()).data;
		expect(first.items).toHaveLength(25);
		f.seed("m00-new");
		const second = await f.request(`/trash?cursor=${first.next_cursor}`);
		expect(second.data.items.map((item: { id: string }) => item.id)).toEqual(["m01", "m00"]);
		expect((await f.request(`/trash?q=x&cursor=${first.next_cursor}`)).status).toBe(400);
		expect((await f.request(`/trash?cursor=${first.next_cursor}x`)).status).toBe(400);
	});

	it("restores per-item atomically and purges missing IDs idempotently with safe failures", async () => {
		const f = fixture();
		f.seed("restore");
		f.seed("purge");
		f.seed("live", "live", "space:kb", false);
		const restored = await f.request("/trash:batchRestore", {
			ids: ["restore", "missing", "live"],
		});
		expect(restored).toMatchObject({
			status: 200,
			data: {
				succeeded: 1,
				failed: 2,
				results: [
					{ id: "restore", ok: true },
					{ id: "missing", ok: false, error: { code: "not_found" } },
					{ id: "live", ok: false },
				],
			},
		});
		expect(
			f.sqlite.prepare("SELECT version, deleted_at FROM memories WHERE id='restore'").get(),
		).toEqual({ version: 2, deleted_at: null });
		expect(
			f.sqlite.prepare("SELECT op FROM memory_versions WHERE memory_id='restore'").get(),
		).toEqual({ op: "restore" });
		for (let attempt = 0; attempt < 2; attempt++) {
			const purged = await f.request("/trash:batchPurge", { ids: ["purge", "missing", "live"] });
			expect(purged.data).toMatchObject({
				succeeded: 2,
				failed: 1,
				results: [
					{ id: "purge", ok: true },
					{ id: "missing", ok: true },
					{ id: "live", ok: false, error: { code: "version_conflict" } },
				],
			});
		}
		expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM changes WHERE op='purged'").get()).toEqual({
			n: 1,
		});
	});

	it.each(["batchRestore", "batchPurge"])("validates %s IDs before any effects", async (op) => {
		const f = fixture();
		f.seed("keep");
		for (const body of [
			{},
			{ ids: [] },
			{ ids: [""] },
			{ ids: [1] },
			{ ids: ["keep", "keep"] },
			{ ids: ["keep"], unknown: 1 },
		])
			expect((await f.request(`/trash:${op}`, body)).status).toBe(400);
		expect(
			(await f.request(`/trash:${op}`, { ids: Array.from({ length: 101 }, (_, i) => `m${i}`) }))
				.status,
		).toBe(413);
		expect(f.sqlite.prepare("SELECT deleted_at FROM memories WHERE id='keep'").get()).toEqual({
			deleted_at: 2,
		});
	});

	it("stores requested/succeeded/failed counts without item IDs or private errors", async () => {
		const f = fixture();
		f.seed("private-id");
		f.sqlite.exec(
			"CREATE TRIGGER fail_purge BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'secret provider failure'); END",
		);
		const result = await f.request("/trash:batchPurge", { ids: ["private-id", "missing"] });
		expect(result.data).toMatchObject({
			succeeded: 1,
			failed: 1,
			results: [{ ok: false, error: { code: "unavailable" } }, { ok: true }],
		});
		expect(JSON.stringify(result.data)).not.toContain("secret provider");
		const rows = f.sqlite
			.prepare("SELECT * FROM audit_log JOIN audit_bulk_counts ON audit_id = id")
			.all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			requested_count: 2,
			succeeded_count: 1,
			failed_count: 1,
			actor: "admin:trash@local",
		});
		expect(JSON.stringify(rows)).not.toContain("private-id");
	});

	it("requires Access and same origin for all bulk writes", async () => {
		const f = fixture();
		for (const action of ["batchRestore", "batchPurge", "empty"]) {
			expect(
				(await f.request(`/trash:${action}`, { ids: ["missing"] }, "https://evil.example")).status,
			).toBe(403);
		}
		delete f.env.ACCESS_DEV_BYPASS_EMAIL;
		for (const action of ["batchRestore", "batchPurge", "empty"])
			expect((await f.request(`/trash:${action}`, {})).status).toBe(401);
		expect((await f.request()).status).toBe(401);
	});

	it("rejects wrong cursor kind and malformed signed payloads", async () => {
		const f = fixture();
		for (const payload of [
			{ kind: "trash-list", filter: '["",""]', head: 0, total: 0 },
			{ kind: "trash-empty", filter: '["",""]', head: 0, total: 0 },
			{ kind: "trash-empty", filter: '["",""]', head: -1, total: 0, ids: ["a"] },
		]) {
			const cursor = await encodeCursor("test-pepper", payload);
			expect((await f.request("/trash:empty", { cursor })).status).toBe(400);
		}
	});

	it("retains durable cleanup and vector tombstones after a partial purge failure", async () => {
		const f = fixture();
		f.seed("purge");
		f.seed("keep");
		f.sqlite.exec(
			"INSERT INTO attachments(id,memory_id,r2_key,filename,content_type,size_bytes,sha256,created_by,created_at) VALUES ('attachment','purge','private-file','a.png','image/png',1,'hash','admin:trash@local',1)",
		);
		f.sqlite.exec(
			"CREATE TRIGGER reject_keep BEFORE DELETE ON memories WHEN OLD.id='keep' BEGIN SELECT RAISE(ABORT,'private error'); END",
		);
		f.files.delete.mockRejectedValue(new Error("private R2 error"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await f.request("/trash:batchPurge", { ids: ["keep", "purge"] });
		expect(result.data).toMatchObject({ succeeded: 1, failed: 1 });
		expect(f.sqlite.prepare("SELECT r2_key FROM external_file_cleanup_jobs").all()).toEqual([
			{ r2_key: "private-file" },
		]);
		expect(
			f.sqlite.prepare("SELECT memory_id FROM vector_sync_jobs WHERE memory_id='purge'").get(),
		).toEqual({ memory_id: "purge" });
		expect(error.mock.calls.flat().join()).not.toContain("private");
	});

	it.each(["memory", "tag", "space"])(
		"atomically refuses a concurrent %s mutation after empty selection",
		async (entity) => {
			const f = fixture();
			f.seed("keep");
			f.sqlite.exec(
				"INSERT INTO tags(id,name,display_name,created_at,updated_at) VALUES ('tag','selected','selected',1,1); INSERT INTO memory_tags(memory_id,tag_id) VALUES ('keep','tag')",
			);
			const batch = f.db.batch.bind(f.db);
			vi.spyOn(f.db, "batch").mockImplementationOnce(async (statements) => {
				const id = entity === "memory" ? "keep" : entity === "tag" ? "tag" : "space:kb";
				f.sqlite
					.prepare(
						"INSERT INTO changes(entity,entity_id,space_id,op,actor,at) VALUES (?,?,'space:kb','updated','admin:other@local',3)",
					)
					.run(entity, id);
				return batch(statements);
			});
			const result = await f.request("/trash:empty", { expected_count: 1 });
			expect(result.data).toMatchObject({
				purged: 0,
				next_cursor: null,
				results: [{ id: "keep", ok: false, error: { code: "version_conflict" } }],
			});
			expect(f.sqlite.prepare("SELECT id FROM memories").all()).toEqual([{ id: "keep" }]);
			expect(f.sqlite.prepare("SELECT * FROM changes WHERE op='purged'").all()).toEqual([]);
		},
	);

	it("reports unknown restore failures safely and continues the remaining IDs", async () => {
		const f = fixture();
		f.seed("bad");
		f.seed("good");
		f.sqlite.exec(
			"CREATE TRIGGER reject_bad BEFORE UPDATE ON memories WHEN OLD.id='bad' BEGIN SELECT RAISE(ABORT,'private data'); END",
		);
		const result = await f.request("/trash:batchRestore", { ids: ["bad", "good"] });
		expect(result.data).toMatchObject({
			succeeded: 1,
			failed: 1,
			results: [{ ok: false, error: { code: "unavailable" } }, { ok: true }],
		});
		expect(JSON.stringify(result.data)).not.toContain("private data");
	});

	it("checks exact expected_count and strict empty schema before purging", async () => {
		const f = fixture();
		f.seed("a");
		for (const body of [
			{ expected_count: -1 },
			{ expected_count: 1.5 },
			{ expected_count: "1" },
			{ filters: { unknown: 1 } },
			{ filters: { space: "" } },
			{ unknown: 1 },
			{ cursor: "bad" },
		])
			expect((await f.request("/trash:empty", body)).status).toBe(400);
		expect((await f.request("/trash:empty", { expected_count: 0 })).status).toBe(409);
		expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memories").get()).toEqual({ n: 1 });
		expect((await f.request("/trash:empty", { expected_count: 1 })).data).toMatchObject({
			purged: 1,
			remaining: 0,
			next_cursor: null,
		});
		expect((await f.request("/trash:empty", {})).data).toEqual({
			results: [],
			purged: 0,
			remaining: 0,
			next_cursor: null,
		});
	});

	it("bounds empty work and replays a continuation without widening its signed snapshot", async () => {
		const f = fixture();
		for (let i = 0; i < 23; i++) f.seed(`m${String(i).padStart(2, "0")}`);
		f.seed("keep", "excluded");
		const body = { filters: { q: "selected" }, expected_count: 23 };
		const first = await f.request("/trash:empty", body);
		expect(first.data.purged).toBeGreaterThan(0);
		expect(first.data.purged).toBeLessThanOrEqual(10);
		expect(first.data.remaining).toBe(23 - first.data.purged);
		expect(first.data.next_cursor).toBeTypeOf("string");
		f.seed("m-new");
		f.sqlite.exec(
			"UPDATE memories SET title='selected' WHERE id='keep'; INSERT INTO changes(entity,entity_id,space_id,op,actor,at) VALUES ('memory','keep','space:kb','updated','admin:trash@local',3)",
		);
		const cursor = first.data.next_cursor;
		expect((await f.request("/trash:empty", { ...body, filters: {}, cursor })).status).toBe(400);
		expect((await f.request("/trash:empty", { ...body, expected_count: 99, cursor })).status).toBe(
			409,
		);
		const second = await f.request("/trash:empty", { ...body, cursor });
		const replay = await f.request("/trash:empty", { ...body, cursor });
		expect(replay.data.purged).toBe(0);
		expect(replay.data.next_cursor).toBe(second.data.next_cursor);
		let next = second.data.next_cursor;
		while (next) {
			const response = await f.request("/trash:empty", { ...body, cursor: next });
			next = response.data.next_cursor;
		}
		expect(f.sqlite.prepare("SELECT id FROM memories ORDER BY id").all()).toEqual([
			{ id: "keep" },
			{ id: "m-new" },
		]);
	});
});
