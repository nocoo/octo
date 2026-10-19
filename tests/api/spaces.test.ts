import { describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { e2eD1, query, sqlText } from "../fixtures/l2-batch";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";

async function d1(sql: string): Promise<void> {
	const exec = await e2eD1();
	await exec(["--command", sql]);
}

async function mint(over: {
	ops?: string;
	scope?: string;
	space_ids_json?: string;
	role?: string;
}): Promise<Record<string, string>> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const now = Date.now();
	const ops = over.ops ?? "r,w,u,d";
	const scope = over.scope ?? "all";
	const spaceIds = over.space_ids_json ?? "[]";
	const role = over.role ?? "admin";
	await d1(
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-${material.keyid}', '${secretHash}', '${role}', '${ops}', '${scope}', '${spaceIds}', 0, 0, NULL, ${now}, ${now})`,
	);
	return { Authorization: `Bearer ${material.plaintext}` };
}

describe("spaces api", () => {
	it("lists and gets only visible spaces", async () => {
		await d1(
			`INSERT OR IGNORE INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('sp-vis', 'visible-room', 'Visible', '', 1, 1)`,
		);
		await d1(
			`INSERT OR IGNORE INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('sp-hid', 'hidden-room', 'Hidden', '', 1, 1)`,
		);
		await d1(
			`INSERT OR IGNORE INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('mem-vis', 'sp-vis', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1)`,
		);

		const anon = await fetch(`${base}/api/v1/spaces`);
		expect(anon.status).toBe(401);

		const scoped = await mint({
			ops: "r",
			scope: "spaces",
			space_ids_json: '["sp-vis"]',
			role: "project",
		});
		const listed = await fetch(`${base}/api/v1/spaces`, { headers: scoped });
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as {
			items: Array<{ slug: string; memory_count: number; created_at: string }>;
			next_cursor: string | null;
		};
		expect(body.next_cursor).toBeNull();
		expect(body.items.map((s) => s.slug)).toEqual(["visible-room"]);
		expect(body.items[0]?.memory_count).toBe(1);
		expect(body.items[0]?.created_at).toMatch(/Z$/);

		const one = await fetch(`${base}/api/v1/spaces/visible-room`, { headers: scoped });
		expect(one.status).toBe(200);
		const detail = (await one.json()) as { slug: string; created_at: string };
		expect(detail.slug).toBe("visible-room");
		expect(detail.created_at).toMatch(/Z$/);

		const writeOnly = await mint({
			ops: "w",
			scope: "spaces",
			space_ids_json: '["sp-vis"]',
			role: "project",
		});
		const writeDenied = await fetch(`${base}/api/v1/spaces/visible-room`, { headers: writeOnly });
		expect(writeDenied.status).toBe(403);

		const hidden = await fetch(`${base}/api/v1/spaces/hidden-room`, { headers: scoped });
		expect(hidden.status).toBe(404);

		const admin = await mint({});
		const adminList = await fetch(`${base}/api/v1/spaces`, { headers: admin });
		expect(adminList.status).toBe(200);
		const all = (await adminList.json()) as { items: Array<{ slug: string }> };
		const slugs = all.items.map((s) => s.slug);
		expect(slugs).toContain("hidden-room");
		expect(slugs).toContain("visible-room");
	});
});

function mutateSpace(
	method: string,
	path: string,
	headers: Record<string, string> = {},
	body?: unknown,
	idem?: string,
) {
	return fetch(`${base}/api/v1/spaces${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...headers,
			...(idem === undefined ? {} : { "Idempotency-Key": idem }),
		},
		...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
	});
}

describe("space CRUD over real HTTP", () => {
	it("creates, renames, clears the description and deletes with key-attributed changes", async () => {
		const headers = await mint({});
		const slug = `crud-${crypto.randomUUID()}`;
		const created = await mutateSpace("POST", "", headers, {
			slug,
			name: "Initial",
			description: "Keep",
		});
		expect(created.status).toBe(201);
		const row = (await created.json()) as { id: string };
		expect(row).toMatchObject({
			slug,
			name: "Initial",
			description: "Keep",
			owner_key_id: null,
			memory_count: 0,
		});
		const renamed = await mutateSpace("PATCH", `/${slug}`, headers, { name: "Renamed" });
		expect(renamed.status).toBe(200);
		expect(await renamed.json()).toMatchObject({
			id: row.id,
			slug,
			name: "Renamed",
			description: "Keep",
		});
		const cleared = await mutateSpace("PATCH", `/${slug}`, headers, { description: "" });
		expect(cleared.status).toBe(200);
		expect(await cleared.json()).toMatchObject({
			id: row.id,
			slug,
			name: "Renamed",
			description: "",
		});
		const duplicate = await mutateSpace("POST", "", headers, { slug, name: "Duplicate" });
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({ error: { code: "version_conflict" } });
		const deleted = await mutateSpace("DELETE", `/${slug}`, headers);
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ id: row.id, slug, deleted: true });
		expect((await fetch(`${base}/api/v1/spaces/${slug}`, { headers })).status).toBe(404);
		for (const method of ["PATCH", "DELETE"]) {
			expect(
				(
					await mutateSpace(
						method,
						`/${slug}`,
						headers,
						method === "PATCH" ? { name: "Missing" } : undefined,
					)
				).status,
			).toBe(404);
		}
		const exec = await e2eD1();
		const keyId = headers.Authorization?.split("_")[1];
		expect(
			await query(
				exec,
				`SELECT op, actor FROM changes WHERE entity_id = ${sqlText(row.id)} ORDER BY seq`,
			),
		).toEqual([
			{ op: "created", actor: `key:${keyId}` },
			{ op: "updated", actor: `key:${keyId}` },
			{ op: "updated", actor: `key:${keyId}` },
			{ op: "deleted", actor: `key:${keyId}` },
		]);
	});

	it("returns 401 without a key and 403 for every non-admin role before parsing", async () => {
		for (const method of ["POST", "PATCH", "DELETE"]) {
			const path = method === "POST" ? "" : "/hidden";
			expect((await mutateSpace(method, path, {}, "{")).status).toBe(401);
			for (const role of ["project", "readonly", "drop", "custom"]) {
				const headers = await mint({ role });
				const denied = await mutateSpace(method, path, headers, "{", "x".repeat(129));
				expect(denied.status).toBe(403);
				expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
			}
		}
	});

	it("rejects empty patches, immutable slugs, owner management and unknown fields", async () => {
		const headers = await mint({});
		const slug = `strict-${crypto.randomUUID()}`;
		expect((await mutateSpace("POST", "", headers, { slug, name: "Strict" })).status).toBe(201);
		for (const patch of [
			{},
			{ slug: "changed" },
			{ owner_key_id: null },
			{ unexpected: true },
			{ name: " " },
			{ description: null },
		]) {
			const rejected = await mutateSpace("PATCH", `/${slug}`, headers, patch);
			expect(rejected.status).toBe(400);
			expect(await rejected.json()).toMatchObject({ error: { code: "validation_failed" } });
		}
		for (const body of [
			{ owner_key_id: null },
			{ unexpected: true },
			{ slug: "Bad Slug" },
			{ slug: "a".repeat(65) },
			{ name: " " },
		]) {
			expect(
				(await mutateSpace("POST", "", headers, { slug, name: "Strict", ...body })).status,
			).toBe(400);
		}
		expect((await mutateSpace("DELETE", `/${slug}`, headers)).status).toBe(200);
	});

	it.each([null, 1000])("rejects nonempty spaces including deleted_at=%s", async (deletedAt) => {
		const headers = await mint({});
		const slug = `nonempty-${crypto.randomUUID()}`;
		const created = await mutateSpace("POST", "", headers, { slug, name: "Nonempty" });
		expect(created.status).toBe(201);
		const row = (await created.json()) as { id: string };
		await d1(
			`INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at) VALUES (${sqlText(crypto.randomUUID())}, ${sqlText(row.id)}, 'T', 'B', 'note', 'key', 'hash', 1, 1, ${deletedAt === null ? "NULL" : deletedAt})`,
		);
		const denied = await mutateSpace("DELETE", `/${slug}`, headers);
		expect(denied.status).toBe(409);
		expect(await denied.json()).toMatchObject({ error: { code: "space_not_empty" } });
		const exec = await e2eD1();
		expect(
			await query(exec, `SELECT op FROM changes WHERE entity_id = ${sqlText(row.id)}`),
		).toEqual([{ op: "created" }]);
		expect((await fetch(`${base}/api/v1/spaces/${slug}`, { headers })).status).toBe(200);
	});

	it("replays each mutation and denies saved responses after an admin role downgrade", async () => {
		const headers = await mint({});
		const slug = `replay-${crypto.randomUUID()}`;
		const operations = [
			["POST", "", { slug, name: "Replay" }, "space-create"],
			["PATCH", `/${slug}`, { name: "Renamed" }, "space-update"],
			["DELETE", `/${slug}`, undefined, "space-delete"],
		] as const;
		for (const [method, path, body, idem] of operations) {
			const first = await mutateSpace(method, path, headers, body, idem);
			expect(first.status).toBe(method === "POST" ? 201 : 200);
			const saved = await first.text();
			const replay = await mutateSpace(method, path, headers, body, idem);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(await replay.text()).toBe(saved);
		}
		const keyId = headers.Authorization?.split("_")[1] ?? "";
		await d1(`UPDATE api_keys SET role = 'project' WHERE id = ${sqlText(keyId)}`);
		for (const [method, path, body, idem] of operations) {
			const denied = await mutateSpace(method, path, headers, body, idem);
			expect(denied.status).toBe(403);
			expect(denied.headers.get("Idempotent-Replayed")).toBeNull();
		}
		const exec = await e2eD1();
		expect(
			await query(
				exec,
				`SELECT COUNT(*) AS n FROM changes WHERE actor = ${sqlText(`key:${keyId}`)}`,
			),
		).toEqual([{ n: 3 }]);
		const audit = await query<{ actor: string; status: number }>(
			exec,
			`SELECT actor, status FROM audit_log WHERE actor = ${sqlText(`key:${keyId}`)} ORDER BY at`,
		);
		expect(audit).toHaveLength(9);
		expect(audit.filter((row) => row.status === 403)).toHaveLength(3);
		expect(JSON.stringify(audit)).not.toContain(headers.Authorization);
	});

	it("rolls back mutation and change together when idempotency storage fails", async () => {
		const headers = await mint({});
		const keyId = headers.Authorization?.split("_")[1] ?? "";
		const slug = `rollback-${crypto.randomUUID()}`;
		const trigger = `space_chunks_${keyId}`;
		await d1(
			`CREATE TRIGGER ${trigger} BEFORE INSERT ON idempotency_response_chunks WHEN NEW.key_id = ${sqlText(keyId)} BEGIN SELECT RAISE(ABORT, 'injected space storage failure'); END`,
		);
		try {
			const failed = await mutateSpace("POST", "", headers, { slug, name: "Rollback" }, "rollback");
			expect(failed.status).toBe(503);
			const exec = await e2eD1();
			expect(await query(exec, `SELECT id FROM spaces WHERE slug = ${sqlText(slug)}`)).toEqual([]);
			expect(
				await query(exec, `SELECT entity_id FROM changes WHERE actor = ${sqlText(`key:${keyId}`)}`),
			).toEqual([]);
			expect(
				await query(
					exec,
					`SELECT idem_key FROM idempotency_records WHERE key_id = ${sqlText(keyId)}`,
				),
			).toEqual([]);
		} finally {
			await d1(`DROP TRIGGER ${trigger}`);
		}
		expect(
			(await mutateSpace("POST", "", headers, { slug, name: "Rollback" }, "rollback")).status,
		).toBe(201);
		expect((await mutateSpace("DELETE", `/${slug}`, headers)).status).toBe(200);
	});
});
