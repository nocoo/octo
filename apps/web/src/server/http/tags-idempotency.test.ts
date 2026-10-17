import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { generateApiKeyMaterial, hashSecret } from "../auth/api-key";
import type { Env } from "../env";
import { createApp } from "../index";

async function fixture() {
	const f = sqliteD1();
	const material = generateApiKeyMaterial();
	const hash = await hashSecret("pepper", material.secret);
	f.sqlite
		.prepare(
			"INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, created_at, updated_at) VALUES (?, 'admin', ?, 'admin', 'r,w,u,d', 'all', 1, 1)",
		)
		.run(material.keyid, hash);
	f.sqlite.exec(`
		INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('m3-s', 'm3-s', 's', 1, 1);
		INSERT INTO tags (id, name, display_name, created_at, updated_at) VALUES ('a', 'alpha', 'Alpha', 1, 1), ('b', 'beta', 'Beta', 1, 1);
		INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('m', 'm3-s', 'title', 'body', 'note', 0.5, 'k', 1, 'h', 1, 1);
		INSERT INTO memory_tags VALUES ('m', 'a');
	`);
	const app = createApp();
	const post = (
		op: string,
		body: object,
		key: string | null = "same",
		token = material.plaintext,
	) =>
		app.request(
			`/api/v1/tags/alpha/${op}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"content-type": "application/json",
					...(key === null ? {} : { "Idempotency-Key": key }),
				},
				body: JSON.stringify(body),
			},
			{ DB: f.db, API_KEY_PEPPER: "pepper" } as Env,
		);
	const rows = (sql: string) => f.sqlite.prepare(sql).all();
	return { ...f, post, rows, material };
}

describe("M3 mutations at the M6 HTTP transaction boundary", () => {
	it.each(["rename", "merge"])("rolls back %s and replays its eventual outcome", async (op) => {
		const f = await fixture();
		try {
			const body = op === "rename" ? { new_name: "gamma" } : { into: "beta" };
			f.sqlite.exec(
				"CREATE TRIGGER fail_chunks BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'storage failed'); END",
			);
			expect((await f.post(op, body)).status).toBe(503);
			expect(f.rows("SELECT name, merged_into FROM tags WHERE id = 'a'")).toEqual([
				{ name: "alpha", merged_into: null },
			]);
			expect(f.rows("SELECT * FROM changes")).toEqual([]);
			expect(f.rows("SELECT * FROM memory_tags")).toEqual([{ memory_id: "m", tag_id: "a" }]);
			expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
			f.sqlite.exec("DROP TRIGGER fail_chunks");
			const first = await f.post(op, body);
			expect(first.status).toBe(200);
			const saved = await first.text();
			const replay = await f.post(op, body);
			expect(replay.status).toBe(200);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(await replay.text()).toBe(saved);
			expect(f.rows("SELECT * FROM changes")).toHaveLength(1);
			expect(f.rows("SELECT version FROM memories")).toEqual([{ version: 1 }]);
		} finally {
			f.sqlite.close();
		}
	});
	it.each(["rename", "merge"])("commits exactly one concurrent %s", async (op) => {
		const f = await fixture();
		try {
			const body = op === "rename" ? { new_name: "gamma" } : { into: "beta" };
			const responses = await Promise.all(Array.from({ length: 8 }, () => f.post(op, body)));
			expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
			expect(responses.filter((r) => r.headers.get("Idempotent-Replayed") === "true")).toHaveLength(
				7,
			);
			expect(new Set(await Promise.all(responses.map((r) => r.text()))).size).toBe(1);
			expect(f.rows("SELECT * FROM changes")).toHaveLength(1);
		} finally {
			f.sqlite.close();
		}
	});
	it.each(["rename", "merge"])(
		"commits unkeyed %s and recovers a lost acknowledgement",
		async (op) => {
			const f = await fixture();
			try {
				const body = op === "rename" ? { new_name: "gamma" } : { into: "beta" };
				const batch = f.db.batch.bind(f.db);
				vi.spyOn(f.db, "batch").mockImplementationOnce(async (s) => {
					await batch(s);
					throw new Error("lost acknowledgement");
				});
				const recovered = await f.post(op, body);
				expect(recovered.status).toBe(200);
				expect(recovered.headers.get("Idempotent-Replayed")).toBe("true");
				expect(f.rows("SELECT * FROM changes")).toHaveLength(1);
				expect((await f.post(op, { extra: true })).status).toBe(409);
			} finally {
				f.sqlite.close();
			}
			const unkeyed = await fixture();
			try {
				expect(
					(await unkeyed.post(op, op === "rename" ? { new_name: "gamma" } : { into: "beta" }, null))
						.status,
				).toBe(200);
				expect(unkeyed.rows("SELECT * FROM changes")).toHaveLength(1);
				expect(unkeyed.rows("SELECT * FROM idempotency_records")).toEqual([]);
			} finally {
				unkeyed.sqlite.close();
			}
		},
	);
	it.each(["rename", "merge"])("rechecks current authorization before replaying %s", async (op) => {
		const f = await fixture();
		try {
			const body = op === "rename" ? { new_name: "gamma" } : { into: "beta" };
			const first = await f.post(op, body);
			expect(first.status).toBe(200);
			const saved = await first.text();
			for (const [scope, ops] of [
				["all", "r"],
				["spaces", "u"],
				["own", "u"],
			]) {
				f.sqlite
					.prepare("UPDATE api_keys SET scope = ?, ops = ? WHERE id = ?")
					.run(scope ?? "", ops ?? "", f.material.keyid);
				const denied = await f.post(op, body);
				expect(denied.status).toBe(403);
				expect(denied.headers.get("Idempotent-Replayed")).toBeNull();
				expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
			}
			f.sqlite
				.prepare("UPDATE api_keys SET scope = 'all', ops = 'u' WHERE id = ?")
				.run(f.material.keyid);
			const replay = await f.post(op, body);
			expect(replay.status).toBe(200);
			expect(await replay.text()).toBe(saved);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(f.rows("SELECT * FROM changes")).toHaveLength(1);
		} finally {
			f.sqlite.close();
		}
	});
	it("rejects a stale rename without renaming the concurrent winner", async () => {
		const f = await fixture();
		try {
			const batch = f.db.batch.bind(f.db);
			vi.spyOn(f.db, "batch").mockImplementationOnce(async (s) => {
				f.sqlite.exec("UPDATE tags SET name = 'winner', updated_at = 2 WHERE id = 'a'");
				return batch(s);
			});
			const res = await f.post("rename", { new_name: "gamma" });
			expect(res.status).toBe(409);
			expect(await res.json()).toMatchObject({ error: { code: "tag_conflict" } });
			expect(f.rows("SELECT name FROM tags WHERE id = 'a'")).toEqual([{ name: "winner" }]);
			expect(f.rows("SELECT * FROM changes")).toEqual([]);
			expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
		} finally {
			f.sqlite.close();
		}
	});
	it("preserves M1 authorization and M3 error envelopes with replay", async () => {
		const f = await fixture();
		try {
			for (const op of ["rename", "merge"]) {
				const body = op === "rename" ? { new_name: "gamma" } : { into: "beta" };
				expect((await f.post(op, body, `anon-${op}`, "invalid")).status).toBe(401);
				for (const [scope, ops, own] of [
					["all", "r", 0],
					["spaces", "u", 0],
					["own", "u", 0],
				] as const) {
					f.sqlite
						.prepare("UPDATE api_keys SET scope = ?, ops = ?, own_entries_only = ? WHERE id = ?")
						.run(scope, ops, own, f.material.keyid);
					const response = await f.post(op, body, `${op}-${scope}-${ops}-${own}`);
					expect(response.status).toBe(403);
					expect(await response.json()).toMatchObject({
						error: { code: "forbidden", request_id: expect.any(String) },
					});
				}
			}
			f.sqlite
				.prepare("UPDATE api_keys SET scope = 'all', ops = 'u', own_entries_only = 0 WHERE id = ?")
				.run(f.material.keyid);
			for (const [op, body, status, code] of [
				["rename", { new_name: "beta" }, 409, "tag_conflict"],
				["merge", { into: "missing" }, 404, "not_found"],
				["merge", { into: "alpha" }, 400, "validation_failed"],
				["rename", { new_name: "gamma", extra: true }, 400, "validation_failed"],
			] as const) {
				const key = `${op}-${code}`;
				const first = await f.post(op, body, key);
				expect(first.status).toBe(status);
				const saved = await first.text();
				expect(JSON.parse(saved)).toMatchObject({
					error: { code, request_id: expect.any(String) },
				});
				const replay = await f.post(op, body, key);
				expect(replay.status).toBe(status);
				expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
				expect(await replay.text()).toBe(saved);
			}
			expect(f.rows("SELECT * FROM changes")).toEqual([]);
		} finally {
			f.sqlite.close();
		}
	});
});
