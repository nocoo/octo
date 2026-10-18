import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { execution } from "../audit/__tests__/app";
import { mintApiKey } from "../auth/api-key";
import type { Env } from "../env";
import { createApp } from "../index";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const db of databases.splice(0)) db.close();
});

async function fixture() {
	const f = sqliteD1();
	databases.push(f.sqlite);
	const key = await mintApiKey(f.db, "tag-delete-pepper", {
		name: "tag-delete",
		role: "custom",
		ops: "u",
		scope: "all",
	});
	f.sqlite.exec(
		"INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES ('unused','unused','Unused',1,1)",
	);
	const app = createApp();
	const background = execution();
	const env = {
		DB: f.db,
		API_KEY_PEPPER: "tag-delete-pepper",
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "owner@local",
	} as Env;
	const remove = (
		name = "unused",
		options: { token?: string | null; idem?: string; admin?: boolean; origin?: string } = {},
	) =>
		app.request(
			`http://localhost/api/${options.admin ? "admin" : "v1"}/tags/${encodeURIComponent(name)}`,
			{
				method: "DELETE",
				headers: {
					...(options.token === null
						? {}
						: { Authorization: `Bearer ${options.token ?? key.plaintext}` }),
					...(options.idem ? { "Idempotency-Key": options.idem } : {}),
					...(options.admin ? { Origin: options.origin ?? "https://octo.dev.hexly.ai" } : {}),
				},
			},
			env,
			background.ctx,
		);
	return { ...f, key, remove, ...background };
}

const permissions = Array.from({ length: 16 }, (_, bits) =>
	["r", "w", "u", "d"].filter((_op, index) => bits & (1 << index)).join(","),
).flatMap((ops) => (["all", "spaces", "own"] as const).map((scope) => ({ ops, scope })));

describe("tag deletion HTTP boundary", () => {
	it.each(permissions)("requires tag_global for $scope [$ops]", async ({ ops, scope }) => {
		const f = await fixture();
		f.sqlite.prepare("UPDATE api_keys SET ops=?,scope=? WHERE id=?").run(ops, scope, f.key.row.id);
		const response = await f.remove();
		const allowed = scope === "all" && ops.split(",").includes("u");
		expect(response.status).toBe(allowed ? 200 : 403);
		expect(await response.json()).toMatchObject(
			allowed ? { name: "unused", deleted: true } : { error: { code: "forbidden" } },
		);
		await f.flush();
	});

	it.each(["missing", "invalid", "revoked", "expired"])(
		"rejects %s credentials before deletion",
		async (kind) => {
			const f = await fixture();
			if (kind === "revoked")
				f.sqlite.prepare("UPDATE api_keys SET revoked_at=1 WHERE id=?").run(f.key.row.id);
			if (kind === "expired")
				f.sqlite.prepare("UPDATE api_keys SET expires_at=1 WHERE id=?").run(f.key.row.id);
			const response = await f.remove("unused", {
				token: kind === "missing" ? null : kind === "invalid" ? "invalid" : f.key.plaintext,
			});
			expect(response.status).toBe(401);
			expect(f.sqlite.prepare("SELECT id FROM tags").all()).toEqual([{ id: "unused" }]);
			await f.flush();
		},
	);

	it("normalizes deletion, returns 404 without replay and reauthorizes cached success", async () => {
		const f = await fixture();
		const name = "  ＵＮＵＳＥＤ  ";
		const first = await f.remove(name, { idem: "delete-once" });
		expect(first.status).toBe(200);
		const saved = await first.text();
		expect(JSON.parse(saved)).toEqual({ name: "unused", deleted: true });
		for (const [scope, ops] of [
			["all", "r,w,d"],
			["spaces", "u"],
			["own", "u"],
		]) {
			f.sqlite
				.prepare("UPDATE api_keys SET scope=?,ops=? WHERE id=?")
				.run(scope ?? "", ops ?? "", f.key.row.id);
			const denied = await f.remove(name, { idem: "delete-once" });
			expect(denied.status).toBe(403);
			expect(denied.headers.get("Idempotent-Replayed")).toBeNull();
		}
		f.sqlite.prepare("UPDATE api_keys SET scope='all',ops='u' WHERE id=?").run(f.key.row.id);
		const replay = await f.remove(name, { idem: "delete-once" });
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(saved);
		const missing = await f.remove();
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
		await f.flush();
	});

	it.each(["live", "trash", "alias"])(
		"blocks %s use and audits code/status/template without raw names",
		async (kind) => {
			const f = await fixture();
			if (kind === "alias") {
				f.sqlite.exec(
					"INSERT INTO tags (id,name,display_name,merged_into,created_at,updated_at) VALUES ('alias','alias','Alias','unused',1,1)",
				);
			} else {
				f.sqlite.exec(
					"INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,content_hash,created_at,updated_at) VALUES ('m','space:dest','t','b','note',0.5,'other','h',1,1); INSERT INTO memory_tags (memory_id,tag_id) VALUES ('m','unused')",
				);
				if (kind === "trash") f.sqlite.exec("UPDATE memories SET deleted_at=2 WHERE id='m'");
			}
			const response = await f.remove(" ＵＮＵＳＥＤ ", { idem: "blocked" });
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ error: { code: "tag_in_use" } });
			const replay = await f.remove(" ＵＮＵＳＥＤ ", { idem: "blocked" });
			expect(replay.status).toBe(409);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			await f.flush();
			const audit = f.sqlite
				.prepare("SELECT actor,method,route,status,error_code FROM audit_log ORDER BY id")
				.all();
			expect(audit).toEqual(
				Array(2).fill({
					actor: `key:${f.key.row.id}`,
					method: "DELETE",
					route: "/api/v1/tags/:name",
					status: 409,
					error_code: "tag_in_use",
				}),
			);
			expect(JSON.stringify(f.sqlite.prepare("SELECT * FROM audit_log").all())).not.toMatch(
				/unused|ＵＮＵＳＥＤ/,
			);
		},
	);

	it.each(["use", "alias"])(
		"rolls back a concurrent %s introduced after prepare with 409",
		async (race) => {
			const f = await fixture();
			const batch = f.db.batch.bind(f.db);
			vi.spyOn(f.db, "batch").mockImplementationOnce(async (statements) => {
				if (race === "alias") {
					f.sqlite.exec(
						"INSERT INTO tags (id,name,display_name,merged_into,created_at,updated_at) VALUES ('alias','alias','Alias','unused',1,1)",
					);
				} else {
					f.sqlite.exec(
						"INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,content_hash,created_at,updated_at) VALUES ('m','space:dest','t','b','note',0.5,'other','h',1,1); INSERT INTO memory_tags (memory_id,tag_id) VALUES ('m','unused')",
					);
				}
				return batch(statements);
			});
			const response = await f.remove("unused", { idem: "race" });
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ error: { code: "tag_in_use" } });
			expect(f.sqlite.prepare("SELECT id FROM tags WHERE id='unused'").get()).toEqual({
				id: "unused",
			});
			expect(f.sqlite.prepare("SELECT * FROM idempotency_records").all()).toEqual([]);
			expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
			await f.flush();
		},
	);

	it.each(["delete", "replay-storage"])(
		"returns unavailable and rolls back deletion on unrelated %s failure",
		async (stage) => {
			const f = await fixture();
			f.sqlite.exec(
				stage === "delete"
					? "CREATE TRIGGER fail_delete BEFORE DELETE ON tags BEGIN SELECT RAISE(ABORT,'private-sql-secret'); END"
					: "CREATE TRIGGER fail_chunks BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT,'private-sql-secret'); END",
			);
			const response = await f.remove("unused", { idem: "failed" });
			expect(response.status).toBe(503);
			const result = await response.text();
			expect(JSON.parse(result)).toMatchObject({ error: { code: "unavailable" } });
			expect(result).not.toContain("private-sql-secret");
			expect(f.sqlite.prepare("SELECT id FROM tags").all()).toEqual([{ id: "unused" }]);
			expect(f.sqlite.prepare("SELECT * FROM idempotency_records").all()).toEqual([]);
			await f.flush();
		},
	);

	it("supports Access admin parity with origin protection, idempotency and audit identity", async () => {
		const f = await fixture();
		expect((await f.remove("unused", { admin: true, origin: "https://evil.example" })).status).toBe(
			403,
		);
		const first = await f.remove("unused", { admin: true, idem: "admin-delete" });
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ name: "unused", deleted: true });
		const replay = await f.remove("unused", { admin: true, idem: "admin-delete" });
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		await f.flush();
		expect(
			f.sqlite
				.prepare("SELECT actor,method,route,status,error_code FROM audit_log WHERE status=200")
				.all(),
		).toEqual(
			Array(2).fill({
				actor: "admin:owner@local",
				method: "DELETE",
				route: "/api/admin/tags/:name",
				status: 200,
				error_code: null,
			}),
		);
	});
});
