import { beforeAll, describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, seedSpace, sqlText } from "../fixtures/l2-batch";

let headers: Record<string, string>;
beforeAll(async () => {
	headers = {
		"Cf-Access-Jwt-Assertion": await signAccessJwt(await loadJwksState(), {
			iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
			aud: L2_ACCESS_AUD,
			exp: Math.floor(Date.now() / 1000) + 3600,
			email: "trash-bulk@local",
		}),
		Origin: "https://octo.hexly.ai",
		"Content-Type": "application/json",
	};
});
function admin(path: string, body?: unknown, extra?: Record<string, string>) {
	return fetch(`${base}/api/admin${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: { ...headers, ...extra },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}
async function trash(space: string, title = "bulk selected") {
	const response = await admin("/memories", {
		space,
		title,
		body: "body",
		type: "note",
		tags: ["bulk-tag"],
	});
	expect(response.status).toBe(201);
	const item = (await response.json()) as { id: string };
	expect(
		(await fetch(`${base}/api/admin/memories/${item.id}`, { method: "DELETE", headers })).status,
	).toBe(200);
	return item.id;
}
type BulkResult = {
	results: Array<{ id: string; ok: boolean; error?: { code: string } }>;
	succeeded: number;
	failed: number;
	purged: number;
	remaining: number;
	next_cursor: string | null;
};

describe("admin trash bulk real HTTP", () => {
	it.each(["batchRestore", "batchPurge", "empty"])(
		"protects %s with Access, origin, strict and bounded bodies",
		async (action) => {
			const key = await seedKey(await e2eD1());
			for (const auth of [{}, { Authorization: `Bearer ${key.token}` }])
				expect(
					(await fetch(`${base}/api/admin/trash:${action}`, { method: "POST", headers: auth }))
						.status,
				).toBe(401);
			expect((await admin(`/trash:${action}`, {}, { Origin: "https://evil.example" })).status).toBe(
				403,
			);
			expect((await admin(`/trash:${action}`, { unexpected: true })).status).toBe(400);
			expect(
				(await fetch(`${base}/api/admin/trash:${action}`, { method: "POST", headers, body: "{" }))
					.status,
			).toBe(400);
			expect((await admin(`/trash:${action}`, { padding: "x".repeat(17_000) })).status).toBe(413);
			if (action !== "empty") {
				expect((await admin(`/trash:${action}`, { ids: ["same", "same"] })).status).toBe(400);
				expect(
					(
						await admin(`/trash:${action}`, {
							ids: Array.from({ length: 101 }, (_, i) => `missing-${i}`),
						})
					).status,
				).toBe(413);
			}
		},
	);

	it("restores/purges independently, tolerates retries and records safe audit counts", async () => {
		const db = await e2eD1();
		const { slug } = await seedSpace(db);
		const id = await trash(slug);
		const missing = `missing-${crypto.randomUUID()}`;
		const response = await admin("/trash:batchRestore", { ids: [id, missing] });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			succeeded: 1,
			failed: 1,
			results: [
				{ id, ok: true },
				{ id: missing, ok: false, error: { code: "not_found" } },
			],
		});
		const partial = await admin("/trash:batchPurge", { ids: [id, missing] });
		expect(await partial.json()).toMatchObject({
			succeeded: 1,
			failed: 1,
			results: [
				{ id, ok: false, error: { code: "version_conflict" } },
				{ id: missing, ok: true },
			],
		});
		expect(
			(await fetch(`${base}/api/admin/memories/${id}`, { method: "DELETE", headers })).status,
		).toBe(200);
		const purges = await Promise.all([
			admin("/trash:batchPurge", { ids: [id] }),
			admin("/trash:batchPurge", { ids: [id] }),
		]);
		for (const result of purges)
			expect(await result.json()).toMatchObject({ succeeded: 1, failed: 0 });
		expect(
			await query(
				db,
				`SELECT COUNT(*) AS n FROM changes WHERE entity_id=${sqlText(id)} AND op='purged'`,
			),
		).toEqual([{ n: 1 }]);
		expect((await fetch(`${base}/api/__test/background`, { method: "POST" })).status).toBe(200);
		const audit = await query(
			db,
			`SELECT a.route,c.requested_count,c.succeeded_count,c.failed_count FROM audit_log a JOIN audit_bulk_counts c ON c.audit_id=a.id WHERE a.request_id=${sqlText(response.headers.get("X-Request-Id") ?? "")}`,
		);
		expect(audit).toEqual([
			{
				route: "/api/admin/trash:batchRestore",
				requested_count: 2,
				succeeded_count: 1,
				failed_count: 1,
			},
		]);
	});

	it("lists literal filters and empties only the signed, count-confirmed snapshot in bounded continuations", async () => {
		const db = await e2eD1();
		const { slug } = await seedSpace(db);
		const ids: string[] = [];
		for (let i = 0; i < 12; i++) ids.push(await trash(slug, `100%_match ${i}`));
		const keep = await trash(slug, "100xxmatch");
		const params = new URLSearchParams({ q: "%_match", space: slug, limit: "5" });
		const listed = await admin(`/trash?${params}`);
		expect(listed.status).toBe(200);
		const page = (await listed.json()) as { total: number; items: unknown[]; next_cursor: string };
		expect(page.total).toBe(12);
		expect(page.items).toHaveLength(5);
		expect((await admin(`/trash?cursor=${page.next_cursor}`)).status).toBe(400);
		expect((await admin(`/trash?space=${slug}&unknown=1`)).status).toBe(400);
		const body = { filters: { q: "%_match", space: slug }, expected_count: 12 };
		expect((await admin("/trash:empty", { ...body, expected_count: 11 })).status).toBe(409);
		const first = await admin("/trash:empty", body);
		expect(first.status).toBe(200);
		const batch = (await first.json()) as BulkResult;
		expect(batch.purged).toBe(10);
		expect(batch.remaining).toBe(2);
		const added = await trash(slug, "100%_match added after confirmation");
		expect(
			(await admin("/trash:empty", { ...body, filters: {}, cursor: batch.next_cursor })).status,
		).toBe(400);
		const second = await admin("/trash:empty", { ...body, cursor: batch.next_cursor });
		expect(await second.json()).toMatchObject({ purged: 2, remaining: 0, next_cursor: null });
		const replay = await admin("/trash:empty", { ...body, cursor: batch.next_cursor });
		expect(await replay.json()).toMatchObject({ purged: 0, remaining: 0, next_cursor: null });
		expect(
			await query(
				db,
				`SELECT id FROM memories WHERE space_id=(SELECT id FROM spaces WHERE slug=${sqlText(slug)}) ORDER BY id`,
			),
		).toEqual([keep, added].sort().map((id) => ({ id })));
		for (const id of ids)
			expect(
				await query(db, `SELECT * FROM memory_versions WHERE memory_id=${sqlText(id)}`),
			).toEqual([]);
	});
});
