import { beforeAll, describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, seedSpace, sqlText } from "../fixtures/l2-batch";

let jwt: string;
let token: string;
let readonlyToken: string;
let writeonlyToken: string;
let updateonlyToken: string;
let outOfScopeToken: string;
let ownerScopedToken: string;
let ownEntriesToken: string;
let slug: string;
let suffix: string;

beforeAll(async () => {
	jwt = await signAccessJwt(await loadJwksState(), {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "parity@local",
	});
	const db = await e2eD1();
	token = (await seedKey(db)).token;
	readonlyToken = (await seedKey(db, { ops: "r" })).token;
	writeonlyToken = (await seedKey(db, { ops: "w" })).token;
	updateonlyToken = (await seedKey(db, { ops: "u" })).token;
	outOfScopeToken = (await seedKey(db, { scope: "spaces", spaceIds: [] })).token;
	ownerScopedToken = (await seedKey(db, { scope: "own" })).token;
	ownEntriesToken = (await seedKey(db, { ownEntriesOnly: true })).token;
	slug = (await seedSpace(db)).slug;
	suffix = crypto.randomUUID();
});

function admin(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
	return fetch(`${base}/api/admin${path}`, {
		method,
		headers: {
			"Cf-Access-Jwt-Assertion": jwt,
			Origin: "https://octo.hexly.ai",
			"Content-Type": "application/json",
			...headers,
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const mirrored = [
	["GET", "/memories"],
	["POST", "/memories"],
	["GET", "/memories/missing"],
	["PATCH", "/memories/missing"],
	["PUT", "/memories/missing/vector"],
	["DELETE", "/memories/missing"],
	["GET", "/memories/missing/versions"],
	["GET", "/memories/missing/versions/1"],
	["GET", "/memories/missing/diff?from=1&to=2"],
	["POST", "/memories/missing/rollback"],
	["POST", "/memories:batchCreate"],
	["POST", "/memories:batchGet"],
	["POST", "/memories:batchUpdate"],
	["POST", "/memories:batchDelete"],
	["GET", "/trash"],
	["POST", "/trash/missing/restore"],
	["GET", "/changes"],
	["GET", "/changes/head"],
	["GET", "/tags"],
	["POST", "/tags/missing/rename"],
	["POST", "/tags/missing/merge"],
	["POST", "/search"],
	["POST", "/memories/missing/attachments"],
	["GET", "/memories/missing/attachments"],
	["GET", "/attachments/missing/url"],
	["DELETE", "/attachments/missing"],
	["DELETE", "/trash/missing"],
] as const;

describe("admin parity real HTTP", () => {
	it.each(mirrored)(
		"requires Access for %s %s even with an admin API key",
		async (method, path) => {
			for (const headers of [new Headers(), new Headers({ Authorization: `Bearer ${token}` })]) {
				const response = await fetch(`${base}/api/admin${path}`, { method, headers });
				expect(response.status).toBe(401);
			}
			if (method !== "GET")
				expect((await admin(path, method, {}, { Origin: "https://evil.example" })).status).toBe(
					403,
				);
		},
	);

	it("mirrors successful memory, version, batch, tag, search, attachment and trash operations", async () => {
		const body = {
			space: slug,
			title: "parity title",
			body: "original",
			type: "note",
			tags: [`a-${suffix}`],
		};
		const created = await admin("/memories", "POST", body, { "Idempotency-Key": suffix });
		expect(created.status).toBe(201);
		const { id } = (await created.json()) as { id: string };
		const replay = await admin("/memories", "POST", body, { "Idempotency-Key": suffix });
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		for (const path of ["/memories", `/memories/${id}`])
			expect((await admin(path)).status).toBe(200);
		expect(
			(await admin(`/memories/${id}`, "PATCH", { body: "updated", expected_version: 1 })).status,
		).toBe(200);
		for (const path of [
			`/memories/${id}/versions`,
			`/memories/${id}/versions/1`,
			`/memories/${id}/diff?from=1&to=2`,
		])
			expect((await admin(path)).status).toBe(200);
		expect(
			(await admin(`/memories/${id}/rollback`, "POST", { to_version: 1, expected_version: 2 }))
				.status,
		).toBe(200);
		expect((await admin("/memories:batchGet", "POST", { ids: [id] })).status).toBe(200);
		expect(
			(await admin("/search", "POST", { query: "parity title", filters: { spaces: [slug] } }))
				.status,
		).toBe(200);
		expect((await admin("/tags")).status).toBe(200);
		expect(
			(await admin(`/tags/a-${suffix}/rename`, "POST", { new_name: `b-${suffix}` })).status,
		).toBe(200);
		const batch = await admin("/memories:batchCreate", "POST", {
			items: [{ ...body, tags: [`c-${suffix}`] }],
		});
		expect(batch.status).toBe(200);
		const batchBody = (await batch.json()) as {
			results: Array<{ ok: boolean; item: { id: string } }>;
		};
		expect(batchBody.results[0]?.ok).toBe(true);
		const second = batchBody.results[0]?.item.id;
		expect((await admin(`/tags/b-${suffix}/merge`, "POST", { into: `c-${suffix}` })).status).toBe(
			200,
		);
		expect(
			(
				await admin("/memories:batchUpdate", "POST", {
					items: [{ id: second, title: "batch updated", expected_version: 1 }],
				})
			).status,
		).toBe(200);
		expect((await admin("/memories:batchDelete", "POST", { ids: [second] })).status).toBe(200);
		const uploaded = await fetch(`${base}/api/admin/memories/${id}/attachments`, {
			method: "POST",
			headers: {
				"Cf-Access-Jwt-Assertion": jwt,
				Origin: "https://octo.hexly.ai",
				"Content-Type": "image/png",
				"X-Filename": "parity.png",
			},
			body: new Uint8Array([137, 80, 78, 71]),
		});
		expect(uploaded.status).toBe(201);
		const attachment = (await uploaded.json()) as { id: string };
		for (const path of [`/memories/${id}/attachments`, `/attachments/${attachment.id}/url`])
			expect((await admin(path)).status).toBe(200);
		expect((await admin(`/attachments/${attachment.id}`, "DELETE")).status).toBe(200);
		expect((await admin(`/memories/${id}`, "DELETE")).status).toBe(200);
		expect((await admin("/trash")).status).toBe(200);
		expect((await admin(`/trash/${id}/restore`, "POST")).status).toBe(200);
		for (const path of ["/changes", "/changes/head"])
			expect((await admin(`${path}?spaces=${slug}`)).status).toBe(200);
		const db = await e2eD1();
		expect(
			await query(
				db,
				`SELECT DISTINCT actor FROM memory_versions WHERE memory_id = ${sqlText(id)}`,
			),
		).toEqual([{ actor: "admin:parity@local" }]);
		expect(
			await query(
				db,
				`SELECT DISTINCT actor FROM changes WHERE entity_id IN (${sqlText(id)}, ${sqlText(attachment.id)})`,
			),
		).toEqual([{ actor: "admin:parity@local" }]);
	});

	it.each([
		["GET", "/memories?limit=0", undefined, 400],
		["GET", "/trash?limit=0", undefined, 400],
		["GET", "/changes?cursor=invalid", undefined, 400],
		["GET", "/memories/missing", undefined, 404],
		["GET", "/memories/missing/versions", undefined, 404],
		["GET", "/memories/missing/versions/0", undefined, 400],
		["GET", "/memories/missing/diff", undefined, 400],
		["POST", "/memories", {}, 400],
		["PATCH", "/memories/missing", { title: "x", expected_version: 1 }, 404],
		[
			"PUT",
			"/memories/missing/vector",
			{ profile: "missing", values: [1], expected_version: 1 },
			404,
		],
		["DELETE", "/memories/missing", undefined, 404],
		["POST", "/memories/missing/rollback", {}, 404],
		["POST", "/trash/missing/restore", undefined, 404],
		["POST", "/memories:batchCreate", {}, 400],
		["POST", "/memories:batchGet", {}, 400],
		["POST", "/memories:batchUpdate", {}, 400],
		["POST", "/memories:batchDelete", {}, 400],
		["POST", "/tags/missing/rename", { new_name: "new" }, 404],
		["POST", "/tags/missing/merge", { into: "other" }, 404],
		["POST", "/search", {}, 400],
		["POST", "/memories/missing/attachments", undefined, 404],
		["GET", "/memories/missing/attachments", undefined, 404],
		["GET", "/attachments/missing/url", undefined, 404],
		["DELETE", "/attachments/missing", undefined, 404],
		["DELETE", "/trash/missing", undefined, 404],
	] as const)("returns safe failures for %s %s", async (method, path, body, status) => {
		expect((await admin(path, method, body)).status).toBe(status);
	});

	it("purges only trash, removes D1 data and durably cleans R2 objects", async () => {
		const created = await admin("/memories", "POST", {
			space: slug,
			title: "purge",
			body: "body",
			type: "note",
			tags: [],
		});
		expect(created.status).toBe(201);
		const { id } = (await created.json()) as { id: string };
		expect((await admin(`/trash/${id}`, "DELETE")).status).toBe(409);
		const uploaded = await fetch(`${base}/api/admin/memories/${id}/attachments`, {
			method: "POST",
			headers: {
				"Cf-Access-Jwt-Assertion": jwt,
				Origin: "https://octo.hexly.ai",
				"Content-Type": "image/png",
				"X-Filename": "purge.png",
			},
			body: new Uint8Array([137, 80, 78, 71]),
		});
		expect(uploaded.status).toBe(201);
		const attachment = (await uploaded.json()) as { id: string };
		const signed = await admin(`/attachments/${attachment.id}/url`);
		expect(signed.status).toBe(200);
		const { url } = (await signed.json()) as { url: string };
		const signedUrl = new URL(url);
		const localUrl = `${base}${signedUrl.pathname}${signedUrl.search}`;
		expect((await fetch(localUrl)).status).toBe(200);
		expect((await admin(`/memories/${id}`, "DELETE")).status).toBe(200);
		const purged = await admin(`/trash/${id}`, "DELETE");
		expect(purged.status).toBe(200);
		expect(await purged.json()).toEqual({ id, purged: true });
		expect((await admin(`/trash/${id}`, "DELETE")).status).toBe(404);
		const database = await e2eD1();
		for (const [table, column] of [
			["memories", "id"],
			["memory_versions", "memory_id"],
			["memory_tags", "memory_id"],
			["memory_vectors", "memory_id"],
			["attachments", "memory_id"],
			["memories_fts_map", "memory_id"],
		])
			expect(
				await query(database, `SELECT * FROM ${table} WHERE ${column} = ${sqlText(id)}`),
			).toEqual([]);
		expect(
			await query(
				database,
				`SELECT actor FROM changes WHERE entity_id = ${sqlText(id)} AND op = 'purged'`,
			),
		).toEqual([{ actor: "admin:parity@local" }]);
		expect((await fetch(`${base}/api/__test/background`, { method: "POST" })).status).toBe(200);
		expect((await fetch(localUrl)).status).toBe(404);
	});

	it.each(["/api/v1", "/api/admin"] as const)(
		"PUT %s/memories/:id/vector enforces OCC and auth",
		async (prefix) => {
			const headers = {
				Authorization: `Bearer ${token}`,
				"Cf-Access-Jwt-Assertion": jwt,
				Origin: "https://octo.hexly.ai",
				"Content-Type": "application/json",
			};
			const created = await fetch(`${base}${prefix}/memories`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					space: slug,
					title: "vector",
					body: "body",
					type: "note",
					tags: [],
				}),
			});
			expect(created.status).toBe(201);
			const { id } = (await created.json()) as { id: string };
			const path = `${base}${prefix}/memories/${id}/vector`;
			const values = Array.from({ length: 1536 }, (_, position) => (position === 0 ? 1 : 0));
			const body = { profile: "te3-small-1536", values, expected_version: 1 };
			expect((await fetch(path, { method: "PUT" })).status).toBe(401);
			if (prefix === "/api/v1") {
				for (const [role, deniedToken, status] of [
					["readonly", readonlyToken, 403],
					["writeonly", writeonlyToken, 403],
					["out of scope", outOfScopeToken, 404],
					["owner scoped", ownerScopedToken, 404],
					["own entries", ownEntriesToken, 403],
				] as const) {
					const response = await fetch(path, {
						method: "PUT",
						headers: { ...headers, Authorization: `Bearer ${deniedToken}` },
						body: JSON.stringify(body),
					});
					expect(response.status, role).toBe(status);
					expect(await response.json()).toMatchObject({
						error: { code: status === 403 ? "forbidden" : "not_found" },
					});
				}
			}
			const put = (input: unknown, extra: Record<string, string> = {}) =>
				fetch(path, {
					method: "PUT",
					headers: { ...headers, ...extra },
					body: JSON.stringify(input),
				});
			for (const invalid of [
				{ profile: body.profile, values },
				{ ...body, expected_version: -1 },
				{ ...body, expected_version: 1.5 },
				{ ...body, expected_version: "1" },
				{ ...body, values: "invalid" },
				{ ...body, values: [] },
				{ ...body, values: [1] },
				{ ...body, values: values.map(() => 0) },
				{ ...body, profile: "missing" },
				{ ...body, title: "rejected" },
				{ vector: { profile: body.profile, values }, expected_version: 1 },
			])
				expect((await put(invalid)).status).toBe(400);
			expect((await put(body, { "If-Match": "invalid" })).status).toBe(400);
			expect((await put(body, { "If-Match": "2" })).status).toBe(400);
			expect((await put({ ...body, expected_version: 0 })).status).toBe(409);
			expect((await put({ ...body, expected_version: 7 })).status).toBe(409);
			const updated = await put(body, { "Idempotency-Key": `vector-${id}` });
			expect(updated.status).toBe(200);
			expect(await updated.json()).toMatchObject({ id, version: 2 });
			const replay = await put(body, { "Idempotency-Key": `vector-${id}` });
			expect(replay.status).toBe(200);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect((await put(body)).status).toBe(409);
			expect((await put({ profile: body.profile, values })).status).toBe(400);
			expect((await put({ ...body, expected_version: 2, values: [1] })).status).toBe(400);
			const database = await e2eD1();
			expect(
				await query(
					database,
					`SELECT dim, length(vector) AS bytes FROM memory_vectors WHERE memory_id = ${sqlText(id)}`,
				),
			).toEqual([{ dim: 1536, bytes: 6144 }]);
			if (prefix === "/api/v1") {
				expect(
					(
						await put(
							{ profile: body.profile, values },
							{ "If-Match": "2", Authorization: `Bearer ${updateonlyToken}` },
						)
					).status,
				).toBe(200);
				for (const readPath of ["/search", "/memories:batchGet"]) {
					const response = await fetch(`${base}/api/v1${readPath}`, {
						method: "POST",
						headers: { ...headers, Authorization: `Bearer ${writeonlyToken}` },
						body: JSON.stringify(readPath === "/search" ? { query: "vector" } : { ids: [id] }),
					});
					expect(response.status).toBe(403);
					expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
				}
			}
		},
	);
});
