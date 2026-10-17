import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";
const prefix = generateApiKeyMaterial().keyid.toLowerCase();
const a = `matrix-a-${prefix}`;
const b = `matrix-b-${prefix}`;
const pageSpace = `matrix-page-${prefix}`;
const autoName = `matrix-auto-${prefix}`;
const tokens: Record<string, string> = {};
const profile = `matrix-${prefix}`;

beforeAll(async () => {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) throw new Error("isolated D1 configuration is required");
	const d1 = createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
	assertTestMarker(d1);
	const sql = [a, b, pageSpace].map(
		(slug) =>
			`INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('${slug}', '${slug}', '${slug}', 1, 1);`,
	);
	for (const [name, ops, scope, ids, auto] of [
		["admin", "r,w,u,d", "all", [], false],
		["full", "r,w,u,d", "spaces", [a], false],
		["reader", "r", "spaces", [a], false],
		["writer", "w", "spaces", [a], false],
		["hidden", "r,w,u,d", "spaces", [b], false],
		["auto", "r", "own", [], true],
	] as const) {
		const material = generateApiKeyMaterial();
		const hash = await hashSecret(pepper, material.secret);
		tokens[name] = material.plaintext;
		sql.push(
			`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, auto_own_space, created_at, updated_at) VALUES ('${material.keyid}', '${auto ? autoName : `matrix-${name}-${prefix}`}', '${hash}', 'custom', '${ops}', '${scope}', '${JSON.stringify(ids)}', ${auto ? 1 : 0}, 1, 1);`,
		);
	}
	sql.push(
		`INSERT INTO embedding_profiles (id, model, dims, metric, vectorize_index, active, created_at) VALUES ('${profile}', 'tiny', 3, 'cosine', 'x', 0, 1);`,
	);
	for (let i = 0; i < 201; i++) {
		const id = `page-${prefix}-${String(i).padStart(3, "0")}`;
		sql.push(
			`INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('${id}', '${pageSpace}', 'page', 'page', 'note', 'fixture', 'fixture', 1, 1);`,
		);
	}
	d1(["--command", sql.join("\n")]);
}, 120_000);

async function request(
	path: string,
	method = "GET",
	key?: string,
	body?: unknown,
	extra: Record<string, string> = {},
) {
	const headers: Record<string, string> = { ...extra };
	if (key) headers.Authorization = `Bearer ${tokens[key]}`;
	if (body !== undefined) headers["content-type"] = "application/json";
	return fetch(`${base}/api/v1${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

async function create(space = a, tags: string[] = []) {
	const res = await request("/memories", "POST", "admin", {
		space,
		title: "matrix",
		body: "one\ntwo\n",
		type: "note",
		tags,
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; version: number };
}

async function error(res: Response, status: number, code: string) {
	expect(res.status).toBe(status);
	expect(await res.json()).toMatchObject({ error: { code, request_id: expect.any(String) } });
}

const cases = [
	{ method: "POST", path: "/memories", denied: "reader", success: 201 },
	{ method: "GET", path: "/memories", denied: "writer", success: 200 },
	{ method: "GET", path: "/memories/:id", denied: "writer", success: 200 },
	{ method: "PATCH", path: "/memories/:id", denied: "reader", success: 200 },
	{ method: "DELETE", path: "/memories/:id", denied: "reader", success: 200 },
	{ method: "GET", path: "/memories/:id/versions", denied: "writer", success: 200 },
	{ method: "GET", path: "/memories/:id/versions/1", denied: "writer", success: 200 },
	{ method: "GET", path: "/memories/:id/diff", denied: "writer", success: 200 },
	{ method: "POST", path: "/memories/:id/rollback", denied: "reader", success: 200 },
	{ method: "GET", path: "/trash", denied: "writer", success: 200 },
	{ method: "POST", path: "/trash/:id/restore", denied: "reader", success: 200 },
	{ method: "GET", path: "/changes", denied: "writer", success: 200 },
	{ method: "GET", path: "/changes/head", denied: "writer", success: 200 },
] as const;

describe("M2 endpoint method behavior matrix", () => {
	it.each(cases)("$method $path covers success, failure, auth, and hidden scope", async (entry) => {
		const item = await create();
		if (entry.path.startsWith("/trash")) {
			expect((await request(`/memories/${item.id}`, "DELETE", "admin")).status).toBe(200);
		}
		let path = entry.path.replace(":id", item.id);
		if (entry.path === "/memories/:id/diff") path += "?from=1&to=1";
		if (
			["/memories", "/trash", "/changes", "/changes/head"].includes(entry.path) &&
			entry.method === "GET"
		)
			path += `?spaces=${a}`;
		const body =
			entry.method === "PATCH"
				? { title: "updated", expected_version: 1 }
				: entry.path.endsWith("/rollback")
					? { to_version: 1, expected_version: 1 }
					: entry.path === "/memories" && entry.method === "POST"
						? { space: a, title: "created", body: "body", type: "note", tags: [] }
						: undefined;
		await error(await request(path, entry.method, undefined, body), 401, "unauthenticated");
		await error(await request(path, entry.method, entry.denied, body), 403, "forbidden");
		const hidden = await request(path, entry.method, "hidden", body);
		if (entry.method === "GET" && ["/memories", "/trash", "/changes"].includes(entry.path)) {
			expect(hidden.status).toBe(200);
			expect(await hidden.json()).toEqual({ items: [], next_cursor: null });
		} else if (entry.path === "/changes/head") {
			expect(hidden.status).toBe(200);
			const head = (await hidden.json()) as { cursor: string };
			expect(JSON.parse(Buffer.from(head.cursor, "base64url").toString())).toEqual({ s: 0 });
		} else {
			await error(hidden, 404, "not_found");
		}

		if (entry.path === "/memories" && entry.method === "POST") {
			await error(
				await request(path, entry.method, "full", { ...body, unexpected: true }),
				400,
				"validation_failed",
			);
		} else if (entry.method === "PATCH") {
			await error(
				await request(path, entry.method, "full", { title: "missing version" }),
				400,
				"validation_failed",
			);
		} else if (entry.path.endsWith("/rollback")) {
			await error(
				await request(path, entry.method, "full", { to_version: 99, expected_version: 1 }),
				422,
				"unprocessable",
			);
		} else if (entry.path.endsWith("/diff")) {
			await error(
				await request(`/memories/${item.id}/diff?from=1&to=99`, "GET", "full"),
				422,
				"unprocessable",
			);
		} else if (entry.path === "/changes") {
			await error(await request("/changes?cursor=!!!", "GET", "full"), 400, "validation_failed");
		} else if (entry.path === "/changes/head") {
			const empty = await request("/changes/head?spaces=unknown-matrix-space", "GET", "full");
			expect(empty.status).toBe(200);
			const head = (await empty.json()) as { cursor: string };
			expect(JSON.parse(Buffer.from(head.cursor, "base64url").toString())).toEqual({ s: 0 });
		} else if (entry.path === "/memories" || entry.path === "/trash") {
			await error(await request(`${entry.path}?limit=0`, "GET", "full"), 400, "validation_failed");
		} else {
			await error(
				await request(path.replace(item.id, "missing-matrix-memory"), entry.method, "full", body),
				404,
				"not_found",
			);
		}

		const success = await request(path, entry.method, "full", body);
		expect(success.status).toBe(entry.success);
		const result = (await success.json()) as { items: unknown[]; cursor: string };
		if (entry.method === "DELETE") {
			expect(result).toEqual({ trashed_at: expect.any(String) });
			await error(await request(`/memories/${item.id}`, "GET", "full"), 404, "not_found");
			const before = await (await request(`/changes?spaces=${a}`, "GET", "full")).json();
			await error(await request(path, "DELETE", "full"), 404, "not_found");
			expect(await (await request(`/changes?spaces=${a}`, "GET", "full")).json()).toEqual(before);
		} else if (
			entry.path.endsWith("/rollback") ||
			entry.path.endsWith("/restore") ||
			entry.method === "PATCH"
		) {
			expect(result).toMatchObject({ id: item.id, version: 2 });
		} else if (entry.path.endsWith("/diff")) {
			expect(result).toMatchObject({ from: 1, to: 1, fields: [], body: { hunks: [] } });
		} else if (entry.path.endsWith("/versions")) {
			expect(result).toMatchObject({ items: [{ version: 1 }] });
			expect(result.items[0]).not.toHaveProperty("body");
		} else if (entry.path.endsWith("/versions/1")) {
			expect(result).toMatchObject({ version: 1, body: "one\ntwo\n" });
		} else if (entry.path === "/changes/head") {
			expect(JSON.parse(Buffer.from(result.cursor, "base64url").toString()).s).toBeGreaterThan(0);
		} else if (entry.method === "GET" && ["/memories", "/trash", "/changes"].includes(entry.path)) {
			expect(result.items).toEqual(
				expect.arrayContaining([
					expect.objectContaining(
						entry.path === "/changes" ? { entity_id: item.id } : { id: item.id },
					),
				]),
			);
		} else {
			expect(result).toMatchObject({ id: expect.any(String), version: 1 });
		}
	});

	it("enforces move and rollback destinations, trash reads, and first-write side effects", async () => {
		const item = await create();
		await error(
			await request(`/memories/${item.id}`, "PATCH", "full", { space: b, expected_version: 1 }),
			404,
			"not_found",
		);
		const moved = await request(`/memories/${item.id}`, "PATCH", "admin", {
			space: b,
			expected_version: 1,
		});
		expect(moved.status).toBe(200);
		expect(await moved.json()).toMatchObject({ space: b, version: 2 });
		await error(
			await request(`/memories/${item.id}/rollback`, "POST", "hidden", {
				to_version: 1,
				expected_version: 2,
			}),
			404,
			"not_found",
		);
		expect(await (await request(`/memories/${item.id}`, "GET", "admin")).json()).toMatchObject({
			space: b,
			version: 2,
		});
		const rolled = await request(`/memories/${item.id}/rollback`, "POST", "admin", {
			to_version: 1,
			expected_version: 2,
		});
		expect(rolled.status).toBe(200);
		expect(await rolled.json()).toMatchObject({ space: a, version: 3 });
		await error(
			await request(`/memories/${item.id}`, "PATCH", "full", {
				title: "stale",
				expected_version: 1,
			}),
			409,
			"version_conflict",
		);
		expect((await request(`/memories/${item.id}`, "DELETE", "full")).status).toBe(200);
		await error(
			await request(`/memories/${item.id}?include=trashed`, "GET", "reader"),
			403,
			"forbidden",
		);
		await error(
			await request(`/memories/${item.id}?include=trashed`, "GET", "hidden"),
			404,
			"not_found",
		);
		expect((await request(`/memories/${item.id}?include=trashed`, "GET", "full")).status).toBe(200);
		await error(
			await request("/memories", "POST", "auto", {
				space: autoName,
				title: "no write",
				body: "b",
				type: "note",
				tags: [],
			}),
			403,
			"forbidden",
		);
		await error(await request(`/spaces/${autoName}`, "GET", "admin"), 404, "not_found");
	});

	it("keeps global cursor order for 200 items and scopes change cursors", async () => {
		const first = await request(`/memories?spaces=${pageSpace}&limit=200`, "GET", "admin");
		expect(first.status).toBe(200);
		const page = (await first.json()) as { items: Array<{ id: string }>; next_cursor: string };
		expect(page.items).toHaveLength(200);
		expect(page.items[0]?.id).toBe(`page-${prefix}-200`);
		const second = await request(
			`/memories?spaces=${pageSpace}&limit=200&cursor=${page.next_cursor}`,
			"GET",
			"admin",
		);
		expect(second.status).toBe(200);
		expect(await second.json()).toMatchObject({
			items: [{ id: `page-${prefix}-000` }],
			next_cursor: null,
		});
		const feed = await request(`/changes?spaces=${a}&limit=1`, "GET", "full");
		expect(feed.status).toBe(200);
		const event = (await feed.json()) as { items: Array<{ seq: number }>; next_cursor: string };
		expect(event.items).toHaveLength(1);
		expect(event.next_cursor).toEqual(expect.any(String));
		const rest = await request(
			`/changes?spaces=${a}&limit=200&cursor=${event.next_cursor}`,
			"GET",
			"full",
		);
		expect(rest.status).toBe(200);
		const events = (await rest.json()) as { items: Array<{ seq: number }> };
		expect(events.items.every((row) => row.seq > (event.items[0]?.seq ?? 0))).toBe(true);
	});

	it("accepts exact UTF-8 boundaries and JSON escape expansion over real HTTP", async () => {
		for (const body of ["a".repeat(1_000_000), `${"中".repeat(333_333)}a`, "\n".repeat(600_000)]) {
			const res = await request("/memories", "POST", "full", {
				space: a,
				title: "boundary",
				body,
				type: "note",
				tags: [],
			});
			expect(res.status).toBe(201);
			expect(await res.json()).toMatchObject({ body, version: 1 });
		}
	});

	it("accepts 100 tags, follows merged aliases, and persists extreme vectors", async () => {
		const names = Array.from({ length: 100 }, (_, i) => `matrix-${prefix}-${i}`);
		const item = await create(a, names);
		const from = names[0] ?? "";
		const into = names[1] ?? "";
		expect((await request(`/tags/${from}/merge`, "POST", "admin", { into })).status).toBe(200);
		const filtered = await request(`/memories?spaces=${a}&tags_all=${from},${into}`, "GET", "full");
		expect(filtered.status).toBe(200);
		expect(await filtered.json()).toMatchObject({ items: [{ id: item.id }] });
		const vector = await request(`/memories/${item.id}`, "PATCH", "full", {
			expected_version: 1,
			vector: { profile, values: [1e200, 1e200, 0] },
		});
		expect(vector.status).toBe(200);
		const status = await request(`/memories/${item.id}?include=vector_status`, "GET", "full");
		expect(status.status).toBe(200);
		expect(await status.json()).toMatchObject({
			vector_status: [{ profile, indexed: false, stale: false }],
		});
		const overflow = await request(`/memories/${item.id}`, "PATCH", "full", {
			expected_version: 2,
			body: "中".repeat(333_334),
		});
		await error(overflow, 413, "payload_too_large");
		expect(await (await request(`/memories/${item.id}`, "GET", "full")).json()).toMatchObject({
			version: 2,
		});
	});
});
