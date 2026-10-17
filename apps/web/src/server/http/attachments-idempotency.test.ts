import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { MAX_ATTACHMENT_BYTES } from "../attachments/content-type";
import { generateApiKeyMaterial, hashSecret } from "../auth/api-key";
import type { Env } from "../env";
import { createApp } from "../index";

async function fixture() {
	const f = sqliteD1();
	const material = generateApiKeyMaterial();
	const hash = await hashSecret("pepper", material.secret);
	f.sqlite
		.prepare(
			"INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, created_at, updated_at) VALUES (?, 'm5-admin', ?, 'admin', 'r,w,u,d', 'all', 1, 1)",
		)
		.run(material.keyid, hash);
	f.sqlite
		.prepare(
			"INSERT INTO spaces (id, slug, name, owner_key_id, created_at, updated_at) VALUES ('m5-s', 'm5-s', 'M5', ?, 1, 1)",
		)
		.run(material.keyid);
	f.sqlite
		.prepare(
			"INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('m5-m', 'm5-s', 'M5', '', 'note', 0.5, ?, 1, 'h', 1, 1)",
		)
		.run(material.keyid);
	const blobs = new Map<string, Uint8Array>();
	const put = vi.fn(async (key: string, bytes: Uint8Array) => {
		blobs.set(key, bytes);
	});
	const del = vi.fn(async (key: string) => {
		blobs.delete(key);
	});
	const env = {
		DB: f.db,
		API_KEY_PEPPER: "pepper",
		ATTACHMENT_URL_SECRET: "secret",
		FILES: { put, delete: del },
	} as unknown as Env;
	const app = createApp();
	const headers = (key: string | null) => ({
		Authorization: `Bearer ${material.plaintext}`,
		"Content-Type": "image/png",
		"X-Filename": "a.png",
		...(key === null ? {} : { "Idempotency-Key": key }),
	});
	const post = (bytes = new Uint8Array([1]), key: string | null = "upload", extra = {}) =>
		app.fetch(
			new Request("http://x/api/v1/memories/m5-m/attachments", {
				method: "POST",
				headers: { ...headers(key), ...extra },
				body: bytes,
			}),
			env,
		);
	const remove = (id: string, key: string | null = "delete") =>
		app.request(
			`/api/v1/attachments/${id}`,
			{
				method: "DELETE",
				headers: headers(key),
			},
			env,
		);
	const rows = (sql: string) => f.sqlite.prepare(sql).all();
	return { ...f, material, app, env, post, remove, rows, blobs, put, del, headers };
}

describe("M5 writes at the M6 transaction boundary", () => {
	it("commits upload metadata, event and replay in one batch", async () => {
		const f = await fixture();
		try {
			const batch = vi.spyOn(f.db, "batch");
			const first = await f.post();
			expect(first.status).toBe(201);
			const saved = await first.text();
			expect(batch).toHaveBeenCalledOnce();
			const replay = await f.post();
			expect(replay.status).toBe(201);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(await replay.text()).toBe(saved);
			expect(f.put).toHaveBeenCalledOnce();
			expect(f.rows("SELECT * FROM attachments")).toHaveLength(1);
			expect(f.rows("SELECT * FROM changes WHERE entity = 'attachment'")).toHaveLength(1);
			expect(f.rows("SELECT * FROM idempotency_records")).toHaveLength(1);
		} finally {
			f.sqlite.close();
		}
	});

	it("rolls back upload and compensates R2 if replay storage fails", async () => {
		const f = await fixture();
		try {
			f.sqlite.exec(
				"CREATE TRIGGER fail_m5 BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'replay failure'); END",
			);
			expect((await f.post()).status).toBe(503);
			expect(f.rows("SELECT * FROM attachments")).toEqual([]);
			expect(f.rows("SELECT * FROM changes WHERE entity = 'attachment'")).toEqual([]);
			expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
			expect(f.blobs.size).toBe(0);
			expect(f.del).toHaveBeenCalledOnce();
			f.sqlite.exec("DROP TRIGGER fail_m5");
			expect((await f.post()).status).toBe(201);
		} finally {
			f.sqlite.close();
		}
	});

	it("preserves the committed blob on a lost batch acknowledgement", async () => {
		const f = await fixture();
		try {
			const batch = f.db.batch.bind(f.db);
			vi.spyOn(f.db, "batch").mockImplementationOnce(async (statements) => {
				await batch(statements);
				throw new Error("acknowledgement lost");
			});
			const response = await f.post();
			expect(response.status).toBe(201);
			expect(response.headers.get("Idempotent-Replayed")).toBe("true");
			expect(f.blobs.size).toBe(1);
			expect(f.del).not.toHaveBeenCalled();
			expect(f.rows("SELECT * FROM attachments")).toHaveLength(1);
		} finally {
			f.sqlite.close();
		}
	});

	it("cleans losing concurrent blobs but keeps the replay winner", async () => {
		const f = await fixture();
		try {
			const responses = await Promise.all(Array.from({ length: 8 }, () => f.post()));
			expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
			expect(new Set(await Promise.all(responses.map((r) => r.text()))).size).toBe(1);
			expect(responses.filter((r) => r.headers.get("Idempotent-Replayed") === "true")).toHaveLength(
				7,
			);
			expect(f.rows("SELECT * FROM attachments")).toHaveLength(1);
			expect(f.rows("SELECT * FROM changes WHERE entity = 'attachment'")).toHaveLength(1);
			const row = f.rows("SELECT r2_key FROM attachments")[0];
			expect([...f.blobs.keys()]).toEqual([row?.r2_key]);
			expect(f.del.mock.calls.length).toBe(f.put.mock.calls.length - 1);
		} finally {
			f.sqlite.close();
		}
	});

	it("recovers the committed winner even if losing R2 cleanup rejects", async () => {
		const f = await fixture();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			let release!: () => void;
			const bothUploaded = new Promise<void>((resolve) => {
				release = resolve;
			});
			let uploaded = 0;
			f.put.mockImplementation(async (key, bytes) => {
				f.blobs.set(key, bytes);
				if (++uploaded === 2) release();
				await bothUploaded;
			});
			f.del.mockRejectedValueOnce(new Error("sensitive-delete-response"));
			const responses = await Promise.all([f.post(), f.post()]);
			expect(responses.map((response) => response.status)).toEqual([201, 201]);
			expect(
				responses.filter((response) => response.headers.get("Idempotent-Replayed") === "true"),
			).toHaveLength(1);
			expect(new Set(await Promise.all(responses.map((response) => response.text()))).size).toBe(1);
			expect(f.rows("SELECT * FROM attachments")).toHaveLength(1);
			expect(f.rows("SELECT * FROM changes WHERE entity = 'attachment'")).toHaveLength(1);
			expect(f.blobs.size).toBe(2);
			expect(logged).toHaveBeenCalledOnce();
			expect(logged).toHaveBeenCalledWith("write compensation failed", {
				request_id: expect.any(String),
			});
			expect(JSON.stringify(logged.mock.calls)).not.toContain("sensitive-delete-response");
		} finally {
			logged.mockRestore();
			f.sqlite.close();
		}
	});

	it.each([null, "upload"])(
		"returns 503 without a winner if R2 cleanup rejects (key=%s)",
		async (key) => {
			const f = await fixture();
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				f.sqlite.exec(
					"CREATE TRIGGER fail_m5 BEFORE INSERT ON changes WHEN NEW.entity = 'attachment' BEGIN SELECT RAISE(ABORT, 'write failed'); END",
				);
				f.del.mockRejectedValueOnce(new Error("sensitive-delete-response"));
				const response = await f.post(new Uint8Array([1]), key);
				expect(response.status).toBe(503);
				expect(response.headers.get("Idempotent-Replayed")).toBeNull();
				expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
				expect(f.rows("SELECT * FROM attachments")).toEqual([]);
				expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
				expect(f.blobs.size).toBe(1);
				expect(logged).toHaveBeenCalledOnce();
				expect(logged).toHaveBeenCalledWith("write compensation failed", {
					request_id: expect.any(String),
				});
				expect(JSON.stringify(logged.mock.calls)).not.toContain("sensitive-delete-response");
			} finally {
				logged.mockRestore();
				f.sqlite.close();
			}
		},
	);

	it("preserves a blob if rollback verification is unavailable", async () => {
		const f = await fixture();
		try {
			f.sqlite.exec(
				"CREATE TRIGGER fail_m5 BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'replay failure'); END",
			);
			const prepare = f.db.prepare.bind(f.db);
			vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
				if (sql.includes("FROM attachments WHERE id = ?"))
					throw new Error("verification unavailable");
				return prepare(sql);
			});
			expect((await f.post()).status).toBe(503);
			expect(f.rows("SELECT * FROM attachments")).toEqual([]);
			expect(f.blobs.size).toBe(1);
			expect(f.del).not.toHaveBeenCalled();
		} finally {
			f.sqlite.close();
		}
	});

	it("rolls back soft delete and event if replay storage fails", async () => {
		const f = await fixture();
		try {
			const created = await f.post(new Uint8Array([1]), null);
			const { id } = (await created.json()) as { id: string };
			f.sqlite.exec(
				"CREATE TRIGGER fail_m5 BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'replay failure'); END",
			);
			expect((await f.remove(id)).status).toBe(503);
			expect(f.rows("SELECT deleted_at FROM attachments")).toEqual([{ deleted_at: null }]);
			expect(f.rows("SELECT * FROM changes WHERE op = 'trashed'")).toEqual([]);
			expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
			f.sqlite.exec("DROP TRIGGER fail_m5");
			const batch = vi.spyOn(f.db, "batch");
			expect((await f.remove(id)).status).toBe(200);
			expect(batch).toHaveBeenCalledOnce();
			const replay = await f.remove(id);
			expect(replay.status).toBe(200);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(f.rows("SELECT * FROM changes WHERE op = 'trashed'")).toHaveLength(1);
			expect(f.blobs.size).toBe(1);
		} finally {
			f.sqlite.close();
		}
	});

	it("distinguishes invalid UTF-8 bytes and upload metadata in replay hashes", async () => {
		const f = await fixture();
		try {
			expect((await f.post(new Uint8Array([255]))).status).toBe(201);
			expect((await f.post(new Uint8Array([254]))).status).toBe(409);
			expect(
				(await f.post(new Uint8Array([255]), "upload", { "X-Filename": "different.png" })).status,
			).toBe(409);
			expect(f.put).toHaveBeenCalledOnce();
		} finally {
			f.sqlite.close();
		}
	});

	it("compensates an unkeyed rollback and keeps a stale delete out of the transaction", async () => {
		const f = await fixture();
		try {
			f.sqlite.exec(
				"CREATE TRIGGER fail_m5_event BEFORE INSERT ON changes WHEN NEW.entity = 'attachment' BEGIN SELECT RAISE(ABORT, 'event failure'); END",
			);
			expect((await f.post(new Uint8Array([1]), null)).status).toBe(503);
			expect(f.blobs.size).toBe(0);
			expect(f.rows("SELECT * FROM attachments")).toEqual([]);
			f.sqlite.exec("DROP TRIGGER fail_m5_event");
			const { id } = (await (await f.post(new Uint8Array([1]), null)).json()) as { id: string };
			const batch = f.db.batch.bind(f.db);
			vi.spyOn(f.db, "batch").mockImplementationOnce(async (statements) => {
				f.sqlite.exec("UPDATE attachments SET deleted_at = 5");
				return batch(statements);
			});
			expect((await f.remove(id)).status).toBe(404);
			expect(f.rows("SELECT deleted_at FROM attachments")).toEqual([{ deleted_at: 5 }]);
			expect(f.rows("SELECT * FROM changes WHERE op = 'trashed'")).toEqual([]);
			expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
		} finally {
			f.sqlite.close();
		}
	});

	it("rechecks delete permission and scope before replaying a soft-deleted attachment", async () => {
		const f = await fixture();
		try {
			const { id } = (await (await f.post()).json()) as { id: string };
			expect((await f.remove(id)).status).toBe(200);
			f.sqlite.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").run(f.material.keyid);
			expect((await f.remove(id)).status).toBe(403);
			f.sqlite
				.prepare("UPDATE api_keys SET ops = 'd', scope = 'spaces' WHERE id = ?")
				.run(f.material.keyid);
			expect((await f.remove(id)).status).toBe(404);
			f.sqlite
				.prepare("UPDATE api_keys SET ops = 'd', scope = 'all' WHERE id = ?")
				.run(f.material.keyid);
			const replay = await f.remove(id);
			expect(replay.status).toBe(200);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(f.rows("SELECT * FROM changes WHERE op = 'trashed'")).toHaveLength(1);
		} finally {
			f.sqlite.close();
		}
	});

	it("bounds and cancels a keyed stream before a full-body hash can consume it", async () => {
		const f = await fixture();
		try {
			let reads = 0;
			const cancel = vi.fn();
			const chunk = new Uint8Array(1024 * 1024);
			const request = new Request("http://x/api/v1/memories/m5-m/attachments", {
				method: "POST",
				headers: f.headers("upload"),
				body: new ReadableStream(
					{
						pull(controller) {
							if (reads === 60) {
								controller.close();
								return;
							}
							reads++;
							controller.enqueue(chunk);
						},
						cancel,
					},
					{ highWaterMark: 0 },
				),
				duplex: "half",
			} as RequestInit);
			const response = await f.app.fetch(request, f.env);
			expect(response.status).toBe(413);
			expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
			expect(reads).toBe(51);
			expect(cancel).toHaveBeenCalledOnce();
			expect(f.put).not.toHaveBeenCalled();
			expect(f.rows("SELECT * FROM idempotency_records")).toEqual([]);
		} finally {
			f.sqlite.close();
		}
	});

	it("hashes multipart file contents independently of the transport boundary", async () => {
		const f = await fixture();
		try {
			const responses: Response[] = [];
			for (let i = 0; i < 2; i++) {
				const form = new FormData();
				form.append("file", new File([new Uint8Array([255])], "a.png", { type: "image/png" }));
				responses.push(
					await f.app.fetch(
						new Request("http://x/api/v1/memories/m5-m/attachments", {
							method: "POST",
							headers: {
								Authorization: f.headers("upload").Authorization,
								"Idempotency-Key": "multipart",
							},
							body: form,
						}),
						f.env,
					),
				);
			}
			expect(responses.map((response) => response.status)).toEqual([201, 201]);
			expect(responses[1]?.headers.get("Idempotent-Replayed")).toBe("true");
			expect(await responses[1]?.text()).toBe(await responses[0]?.text());
			expect(f.put).toHaveBeenCalledOnce();
		} finally {
			f.sqlite.close();
		}
	});

	it.each(["declared oversize", "forbidden", "replay revoked"])(
		"authorizes and bounds keyed bodies before hashing: %s",
		async (mode) => {
			const f = await fixture();
			try {
				if (mode === "replay revoked") expect((await f.post()).status).toBe(201);
				if (mode !== "declared oversize")
					f.sqlite.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").run(f.material.keyid);
				const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
					controller.enqueue(new Uint8Array([1]));
					controller.close();
				});
				const cancel = vi.fn();
				const request = new Request("http://x/api/v1/memories/m5-m/attachments", {
					method: "POST",
					headers: {
						...f.headers("upload"),
						...(mode === "declared oversize"
							? { "Content-Length": String(MAX_ATTACHMENT_BYTES + 1) }
							: {}),
					},
					body: new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
					duplex: "half",
				} as RequestInit);
				const response = await f.app.fetch(request, f.env);
				expect(response.status).toBe(mode === "declared oversize" ? 413 : 403);
				expect(response.headers.get("Idempotent-Replayed")).toBeNull();
				expect(pull).not.toHaveBeenCalled();
				expect(cancel).not.toHaveBeenCalled();
				await request.body?.cancel();
			} finally {
				f.sqlite.close();
			}
		},
	);
});
