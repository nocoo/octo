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

	it("rejects empty patches, invalid slugs, owner management and unknown fields", async () => {
		const headers = await mint({});
		const slug = `strict-${crypto.randomUUID()}`;
		expect((await mutateSpace("POST", "", headers, { slug, name: "Strict" })).status).toBe(201);
		for (const patch of [
			{},
			{ slug: "Bad Slug" },
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

type SpaceDetail = {
	id: string;
	slug: string;
	name: string;
	description: string;
	updated_at: string;
};

async function createRenameSpace(headers: Record<string, string>) {
	const slug = `rename-${crypto.randomUUID()}`;
	const response = await mutateSpace("POST", "", headers, {
		slug,
		name: "Original name",
		description: "Original description",
	});
	expect(response.status).toBe(201);
	return (await response.json()) as SpaceDetail;
}

function memoryRequest(
	path: string,
	headers: Record<string, string>,
	method = "GET",
	body?: unknown,
) {
	return fetch(`${base}/api/v1${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function expectSlugError(response: Response, status: number) {
	expect(response.status).toBe(status);
	expect(await response.json()).toMatchObject({
		error: {
			code: status === 409 ? "version_conflict" : "validation_failed",
			details: { issues: expect.arrayContaining([expect.objectContaining({ path: "slug" })]) },
		},
	});
}

describe("space slug aliases over HTTP", () => {
	it("replays the saved PATCH ETag and body without mutating a subsequently renamed space", async () => {
		const headers = await mint({});
		const original = await createRenameSpace(headers);
		const requestHeaders = {
			...headers,
			"If-Match": `"${Date.parse(original.updated_at)}"`,
		};
		const body = { slug: `replayed-${crypto.randomUUID()}`, name: "Saved name" };
		const first = await mutateSpace(
			"PATCH",
			`/${original.slug}`,
			requestHeaders,
			body,
			"space-etag",
		);
		expect(first.status).toBe(200);
		const saved = await first.text();
		const etag = `"${Date.parse((JSON.parse(saved) as SpaceDetail).updated_at)}"`;
		expect(first.headers.get("ETag")).toBe(etag);
		const latestSlug = `latest-${crypto.randomUUID()}`;
		const changed = await mutateSpace("PATCH", `/${body.slug}`, headers, {
			slug: latestSlug,
			name: "Current name",
		});
		expect(changed.status).toBe(200);
		expect(changed.headers.get("ETag")).not.toBe(etag);
		const current = await changed.text();
		const exec = await e2eD1();
		const snapshot = async () => ({
			space: await query(exec, `SELECT * FROM spaces WHERE id = ${sqlText(original.id)}`),
			aliases: await query(
				exec,
				`SELECT * FROM space_slug_aliases WHERE space_id = ${sqlText(original.id)} ORDER BY slug`,
			),
			changes: await query(
				exec,
				`SELECT * FROM changes WHERE entity_id = ${sqlText(original.id)} ORDER BY seq`,
			),
		});
		const before = await snapshot();
		const replay = await mutateSpace(
			"PATCH",
			`/${original.slug}`,
			requestHeaders,
			body,
			"space-etag",
		);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(replay.headers.get("ETag")).toBe(etag);
		expect([null, String(new TextEncoder().encode(saved).byteLength)]).toContain(
			replay.headers.get("Content-Length"),
		);
		expect(await replay.text()).toBe(saved);
		expect(await snapshot()).toEqual(before);
		const after = await fetch(`${base}/api/v1/spaces/${latestSlug}`, { headers });
		expect(after.status).toBe(200);
		expect(await after.text()).toBe(current);
	});

	it("returns canonical slugs through GET/PATCH/DELETE aliases and removes aliases on delete", async () => {
		const headers = await mint({});
		const original = await createRenameSpace(headers);
		const slug = `canonical-${crypto.randomUUID()}`;
		const renamed = await mutateSpace("PATCH", `/${original.slug}`, headers, { slug });
		expect(renamed.status).toBe(200);
		expect(await renamed.json()).toMatchObject({
			...original,
			slug,
			updated_at: expect.any(String),
		});
		const exec = await e2eD1();
		const aliases = await query<{
			slug: string;
			space_id: string;
			created_at: number;
			expires_at: number;
		}>(
			exec,
			`SELECT slug, space_id, created_at, expires_at FROM space_slug_aliases WHERE space_id = ${sqlText(original.id)}`,
		);
		expect(aliases).toEqual([
			{
				slug: original.slug,
				space_id: original.id,
				created_at: expect.any(Number),
				expires_at: expect.any(Number),
			},
		]);
		expect((aliases[0]?.expires_at ?? 0) - (aliases[0]?.created_at ?? 0)).toBe(30 * 86_400_000);
		for (const selector of [original.slug, slug]) {
			const get = await fetch(`${base}/api/v1/spaces/${selector}`, { headers });
			expect(get.status).toBe(200);
			expect(await get.json()).toMatchObject({
				id: original.id,
				slug,
				name: original.name,
				description: original.description,
			});
		}
		const edited = await mutateSpace("PATCH", `/${original.slug}`, headers, {
			name: "Changed name",
		});
		expect(edited.status).toBe(200);
		expect(await edited.json()).toMatchObject({
			id: original.id,
			slug,
			name: "Changed name",
			description: original.description,
		});
		const described = await mutateSpace("PATCH", `/${slug}`, headers, {
			description: "Changed description",
		});
		expect(described.status).toBe(200);
		expect(await described.json()).toMatchObject({
			id: original.id,
			slug,
			name: "Changed name",
			description: "Changed description",
		});
		const deleted = await mutateSpace("DELETE", `/${original.slug}`, headers);
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ id: original.id, slug, deleted: true });
		expect(
			await query(
				exec,
				`SELECT slug FROM space_slug_aliases WHERE space_id = ${sqlText(original.id)}`,
			),
		).toEqual([]);
		for (const selector of [original.slug, slug]) {
			expect((await fetch(`${base}/api/v1/spaces/${selector}`, { headers })).status).toBe(404);
		}
	});

	it.each([false, true])(
		"accepts %s-quoted millisecond If-Match tokens and rejects stale updates atomically",
		async (quoted) => {
			const headers = await mint({});
			const original = await createRenameSpace(headers);
			const get = await fetch(`${base}/api/v1/spaces/${original.slug}`, { headers });
			expect(get.status).toBe(200);
			const token = String(Date.parse(original.updated_at));
			expect(get.headers.get("ETag")).toBe(`"${token}"`);
			const ifMatch = quoted ? `"${token}"` : token;
			const slug = `matched-${crypto.randomUUID()}`;
			const renamed = await mutateSpace(
				"PATCH",
				`/${original.slug}`,
				{ ...headers, "If-Match": ifMatch },
				{ slug },
			);
			expect(renamed.status).toBe(200);
			const current = (await renamed.json()) as SpaceDetail;
			expect(Date.parse(current.updated_at)).toBeGreaterThan(Number(token));
			expect(renamed.headers.get("ETag")).toBe(`"${Date.parse(current.updated_at)}"`);
			const stale = await mutateSpace(
				"PATCH",
				`/${original.slug}`,
				{ ...headers, "If-Match": ifMatch },
				{ slug: `stale-${crypto.randomUUID()}`, name: "Must not change" },
			);
			expect(stale.status).toBe(412);
			expect(await stale.json()).toMatchObject({ error: { code: "version_conflict" } });
			const after = await fetch(`${base}/api/v1/spaces/${slug}`, { headers });
			expect(await after.json()).toEqual(current);
			const exec = await e2eD1();
			expect(
				await query(
					exec,
					`SELECT op FROM changes WHERE entity_id = ${sqlText(original.id)} ORDER BY seq`,
				),
			).toEqual([{ op: "created" }, { op: "updated" }]);
			expect(
				await query(
					exec,
					`SELECT slug FROM space_slug_aliases WHERE space_id = ${sqlText(original.id)}`,
				),
			).toEqual([{ slug: original.slug }]);
		},
	);

	it.each(["Bad Slug", "bad_slug", "-leading", "trailing-", "double--dash", "", "a".repeat(65)])(
		"reports the invalid slug field for %j",
		async (slug) => {
			const headers = await mint({});
			const original = await createRenameSpace(headers);
			await expectSlugError(
				await mutateSpace("PATCH", `/${original.slug}`, headers, { slug }),
				400,
			);
			const after = await fetch(`${base}/api/v1/spaces/${original.slug}`, { headers });
			expect(await after.json()).toEqual(original);
		},
	);

	it("rejects canonical/live-alias collisions, allows same-space rename-back and ignores expired aliases", async () => {
		const headers = await mint({});
		const first = await createRenameSpace(headers);
		const second = await createRenameSpace(headers);
		await expectSlugError(
			await mutateSpace("PATCH", `/${first.slug}`, headers, { slug: second.slug }),
			409,
		);
		const canonical = `occupied-${crypto.randomUUID()}`;
		expect(
			(await mutateSpace("PATCH", `/${first.slug}`, headers, { slug: canonical })).status,
		).toBe(200);
		await expectSlugError(
			await mutateSpace("PATCH", `/${second.slug}`, headers, { slug: first.slug }),
			409,
		);
		await expectSlugError(
			await mutateSpace("POST", "", headers, { slug: first.slug, name: "Alias collision" }),
			409,
		);
		const back = await mutateSpace("PATCH", `/${canonical}`, headers, { slug: first.slug });
		expect(back.status).toBe(200);
		expect(await back.json()).toMatchObject({ id: first.id, slug: first.slug });
		expect((await fetch(`${base}/api/v1/spaces/${canonical}`, { headers })).status).toBe(200);
		await d1(
			`UPDATE space_slug_aliases SET expires_at = ${Date.now() - 1} WHERE slug = ${sqlText(canonical)}`,
		);
		for (const method of ["GET", "PATCH", "DELETE"]) {
			const missing =
				method === "GET"
					? await fetch(`${base}/api/v1/spaces/${canonical}`, { headers })
					: await mutateSpace(
							method,
							`/${canonical}`,
							headers,
							method === "PATCH" ? { name: "Expired" } : undefined,
						);
			expect(missing.status).toBe(404);
		}
		const reused = await mutateSpace("PATCH", `/${second.slug}`, headers, { slug: canonical });
		expect(reused.status).toBe(200);
		expect(await reused.json()).toMatchObject({ id: second.id, slug: canonical });
	});

	it("keeps ID-scoped read/write/search permissions and alias memory/change filters after rename", async () => {
		const admin = await mint({});
		const original = await createRenameSpace(admin);
		const outside = await createRenameSpace(admin);
		const scoped = await mint({
			role: "project",
			scope: "spaces",
			space_ids_json: JSON.stringify([original.id]),
		});
		const denied = await mint({
			role: "project",
			scope: "spaces",
			space_ids_json: JSON.stringify([outside.id]),
		});
		const needle = `renamesearch${crypto.randomUUID().replaceAll("-", "")}`;
		const before = await memoryRequest("/memories", scoped, "POST", {
			space: original.slug,
			title: needle,
			body: needle,
			type: "note",
			tags: [],
		});
		expect(before.status).toBe(201);
		const memory = (await before.json()) as { id: string };
		const slug = `scoped-${crypto.randomUUID()}`;
		expect((await mutateSpace("PATCH", `/${original.slug}`, admin, { slug })).status).toBe(200);
		const read = await memoryRequest(`/memories/${memory.id}`, scoped);
		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ id: memory.id, space: slug, version: 1 });
		const updated = await memoryRequest(`/memories/${memory.id}`, scoped, "PATCH", {
			body: `${needle} updated`,
			expected_version: 1,
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({ id: memory.id, space: slug, version: 2 });
		for (const selector of [original.slug, slug]) {
			const created = await memoryRequest("/memories", scoped, "POST", {
				space: selector,
				title: needle,
				body: needle,
				type: "note",
				tags: [],
			});
			expect(created.status).toBe(201);
			expect(await created.json()).toMatchObject({ space: slug });
		}
		for (const selector of [original.slug, slug, `${original.slug},${slug}`]) {
			const listed = await memoryRequest(`/memories?spaces=${selector}`, scoped);
			expect(listed.status).toBe(200);
			const list = (await listed.json()) as { items: Array<{ id: string; space: string }> };
			expect(list.items).toHaveLength(3);
			expect(list.items.every((item) => item.space === slug)).toBe(true);
			const found = await memoryRequest("/search", scoped, "POST", {
				query: needle,
				mode: "fts",
				filters: { spaces: selector.split(",") },
			});
			expect(found.status).toBe(200);
			expect(await found.json()).toMatchObject({
				items: expect.arrayContaining([expect.objectContaining({ id: memory.id, space: slug })]),
			});
			const changes = await memoryRequest(`/changes?spaces=${selector}&limit=200`, scoped);
			expect(changes.status).toBe(200);
			expect(await changes.json()).toMatchObject({
				items: expect.arrayContaining([
					expect.objectContaining({ entity_id: memory.id, space_id: original.id }),
				]),
			});
			const hidden = await memoryRequest(`/memories?spaces=${selector}`, denied);
			expect(await hidden.json()).toMatchObject({ items: [] });
			const hiddenChanges = await memoryRequest(`/changes?spaces=${selector}`, denied);
			expect(await hiddenChanges.json()).toMatchObject({ items: [] });
			const hiddenSearch = await memoryRequest("/search", denied, "POST", {
				query: needle,
				mode: "fts",
				filters: { spaces: selector.split(",") },
			});
			expect(await hiddenSearch.json()).toMatchObject({ items: [] });
		}
		for (const selector of [original.slug, slug]) {
			expect((await fetch(`${base}/api/v1/spaces/${selector}`, { headers: denied })).status).toBe(
				404,
			);
			expect(
				(
					await memoryRequest("/memories", denied, "POST", {
						space: selector,
						title: "Denied",
						body: "Denied",
						type: "note",
						tags: [],
					})
				).status,
			).toBe(404);
		}
		expect((await memoryRequest(`/memories/${memory.id}`, denied)).status).toBe(404);
		expect(
			(
				await memoryRequest(`/memories/${memory.id}`, denied, "PATCH", {
					title: "Denied",
					expected_version: 2,
				})
			).status,
		).toBe(404);
		const exec = await e2eD1();
		const keyId = scoped.Authorization?.split("_")[1] ?? "";
		expect(
			await query(exec, `SELECT space_ids_json FROM api_keys WHERE id = ${sqlText(keyId)}`),
		).toEqual([{ space_ids_json: JSON.stringify([original.id]) }]);
		await d1(
			`UPDATE space_slug_aliases SET expires_at = ${Date.now() - 1} WHERE slug = ${sqlText(original.slug)}`,
		);
		expect(
			(
				await memoryRequest("/memories", scoped, "POST", {
					space: original.slug,
					title: "Expired",
					body: "Expired",
					type: "note",
					tags: [],
				})
			).status,
		).toBe(404);
		for (const path of [`/memories?spaces=${original.slug}`, `/changes?spaces=${original.slug}`]) {
			expect(await (await memoryRequest(path, scoped)).json()).toMatchObject({ items: [] });
		}
		expect(
			await (
				await memoryRequest("/search", scoped, "POST", {
					query: needle,
					mode: "fts",
					filters: { spaces: [original.slug] },
				})
			).json(),
		).toMatchObject({ items: [] });
	});
});
