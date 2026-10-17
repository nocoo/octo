import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, sqlText } from "../fixtures/l2-batch";

let reader: Awaited<ReturnType<typeof seedKey>>;
let writer: Awaited<ReturnType<typeof seedKey>>;
let adminJwt = "";
const seedPrefix = `audit-${crypto.randomUUID()}`;
const firstId = `${seedPrefix}-a`;
const secondId = `${seedPrefix}-b`;
const seedAt = Date.UTC(2020, 0, 2);

type AuditItem = {
	id: string;
	actor: string;
	route: string;
	status: number;
	request_id: string;
};
type Page<T> = { items: T[]; next_cursor: string | null };
type UsageItem = { day: string; key_id: string; calls: number };

function access(jwt = adminJwt) {
	return { "Cf-Access-Jwt-Assertion": jwt };
}
function bearer(token = reader.token) {
	return { Authorization: `Bearer ${token}` };
}
async function getAdmin(path: string, jwt = adminJwt) {
	return fetch(`${base}/api/admin/${path}`, { headers: access(jwt) });
}

beforeAll(async () => {
	const database = await e2eD1();
	await assertAsyncTestMarker(database);
	reader = await seedKey(database, { ops: "r" });
	writer = await seedKey(database, { ops: "w" });
	const state = await loadJwksState();
	adminJwt = await signAccessJwt(state, {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "audit-l2@local",
	});
	await database([
		"--command",
		`INSERT INTO audit_log (id,at,actor,method,route,status,request_id,duration_ms) VALUES
		(${sqlText(firstId)},${seedAt},${sqlText(`key:${reader.id}`)},'GET','/api/v1/memories/:id',403,'seed-a',1),
		(${sqlText(secondId)},${seedAt},${sqlText(`key:${reader.id}`)},'GET','/api/v1/memories/:id',403,'seed-b',2);
		INSERT INTO usage_daily (day,key_id,calls,errors,writes,bytes_in,bytes_out) VALUES
		('2020-01-01',${sqlText(reader.id)},1,0,0,2,3),
		('2020-01-02',${sqlText(reader.id)},4,1,1,5,6),
		('2020-01-02',${sqlText(writer.id)},7,0,0,8,9);`,
	]);
});

afterAll(async () => {
	if (!reader || !writer) return;
	const database = await e2eD1();
	await assertAsyncTestMarker(database);
	const ids = [reader.id, writer.id].map(sqlText).join(",");
	await database([
		"--command",
		`DELETE FROM audit_log WHERE id IN (${sqlText(firstId)},${sqlText(secondId)})
		OR actor IN (${sqlText(`key:${reader.id}`)},${sqlText(`key:${writer.id}`)});
		DELETE FROM usage_daily WHERE key_id IN (${ids});
		DELETE FROM api_keys WHERE id IN (${ids});`,
	]);
});

describe("GET /api/admin/audit", () => {
	it("filters history with stable cursor pagination and rejects invalid filters", async () => {
		const filters = new URLSearchParams({
			from: "2020-01-02",
			to: "2020-01-02",
			actor: `key:${reader.id}`,
			action: "/api/v1/memories/:id",
			status: "403",
			limit: "1",
		});
		const response = await getAdmin(`audit?${filters}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("X-Request-Id")).toBeTruthy();
		const first = (await response.json()) as Page<AuditItem>;
		expect(first.items.map((item) => item.id)).toEqual([secondId]);
		expect(first.next_cursor).toBeTypeOf("string");
		filters.set("cursor", first.next_cursor as string);
		const second = (await (await getAdmin(`audit?${filters}`)).json()) as Page<AuditItem>;
		expect(second.items.map((item) => item.id)).toEqual([firstId]);
		expect(second.next_cursor).toBeNull();
		for (const filter of ["from=2026-02-30", "status=600", "limit=0", "cursor=bad", "unknown=1"]) {
			const invalid = await getAdmin(`audit?${filter}`);
			expect(invalid.status).toBe(400);
			expect(await invalid.json()).toMatchObject({ error: { code: "validation_failed" } });
		}
	});

	it("audits unauthenticated, forbidden and unmatched calls without request secrets", async () => {
		const secret = `do-not-store-${crypto.randomUUID()}`;
		const requestId = crypto.randomUUID();
		const denied = await fetch(`${base}/api/v1/embedding-profiles?api_key=${secret}`, {
			headers: {
				"X-Request-Id": requestId,
				"User-Agent": secret,
				Authorization: `Bearer ${secret}`,
			},
		});
		expect(denied.status).toBe(401);
		const forbidden = await fetch(`${base}/api/v1/embedding-profiles`, {
			headers: bearer(writer.token),
		});
		expect(forbidden.status).toBe(403);
		const missing = await fetch(`${base}/api/v1/${secret}`, { headers: bearer() });
		expect(missing.status).toBe(404);
		await vi.waitFor(
			async () => {
				const anonymous = (await (
					await getAdmin(
						"audit?actor=anonymous&action=/api/v1/embedding-profiles&status=401&limit=200",
					)
				).json()) as Page<AuditItem>;
				expect(anonymous.items).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							request_id: requestId,
							route: "/api/v1/embedding-profiles",
							status: 401,
						}),
					]),
				);
				expect(JSON.stringify(anonymous)).not.toContain(secret);
				const keyDenied = (await (
					await getAdmin(`audit?actor=key:${writer.id}&status=403`)
				).json()) as Page<AuditItem>;
				expect(keyDenied.items).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ route: "/api/v1/embedding-profiles", status: 403 }),
					]),
				);
				const notFound = (await (
					await getAdmin(`audit?actor=key:${reader.id}&status=404`)
				).json()) as Page<AuditItem>;
				expect(notFound.items).toEqual(
					expect.arrayContaining([expect.objectContaining({ route: "unmatched", status: 404 })]),
				);
				expect(JSON.stringify(notFound)).not.toContain(secret);
			},
			{ timeout: 10_000, interval: 50 },
		);
	});

	it("requires Access independently of API key auth", async () => {
		for (const headers of [{}, bearer(), access("invalid")]) {
			const response = await fetch(`${base}/api/admin/audit`, { headers });
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
		}
	});
});

describe("GET /api/admin/usage", () => {
	it("returns per-key rows and inclusive UTC day bounds", async () => {
		const response = await getAdmin("usage?from=2020-01-02&to=2020-01-02");
		expect(response.status).toBe(200);
		const body = (await response.json()) as Page<UsageItem>;
		expect(body.items.filter((row) => [reader.id, writer.id].includes(row.key_id))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ day: "2020-01-02", key_id: reader.id, calls: 4 }),
				expect.objectContaining({ day: "2020-01-02", key_id: writer.id, calls: 7 }),
			]),
		);
		const own = await getAdmin(`usage?from=2020-01-01&to=2020-01-02&key_id=${reader.id}&limit=1`);
		const first = (await own.json()) as Page<UsageItem>;
		expect(first.items).toHaveLength(1);
		expect(first.next_cursor).toBeTypeOf("string");
		const next = await getAdmin(
			`usage?from=2020-01-01&to=2020-01-02&key_id=${reader.id}&limit=1&cursor=${first.next_cursor}`,
		);
		expect(await next.json()).toMatchObject({
			items: [{ day: "2020-01-01", key_id: reader.id }],
			next_cursor: null,
		});
	});

	it("rejects invalid filters and requires Access", async () => {
		const invalid = await getAdmin("usage?key_id=bad");
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ error: { code: "validation_failed" } });
		expect((await fetch(`${base}/api/admin/usage`, { headers: bearer() })).status).toBe(401);
	});
});

describe("GET /api/v1/usage", () => {
	it("returns only the authenticated key even with malicious key_id", async () => {
		for (const token of [reader.token, writer.token]) {
			const expected = token === reader.token ? reader.id : writer.id;
			const response = await fetch(
				`${base}/api/v1/usage?key_id=${reader.id}&from=2020-01-01&to=2020-01-02`,
				{ headers: bearer(token) },
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as Page<UsageItem>;
			expect(body.items.length).toBeGreaterThan(0);
			expect(body.items.every((row) => row.key_id === expected)).toBe(true);
		}
		const response = await fetch(
			`${base}/api/v1/usage?key_id=%27%20OR%201=1--&from=2020-01-02&to=2020-01-02`,
			{ headers: bearer() },
		);
		expect(await response.json()).toMatchObject({
			items: [{ day: "2020-01-02", key_id: reader.id }],
			next_cursor: null,
		});
	});

	it("rejects invalid queries and unauthenticated callers", async () => {
		const invalid = await fetch(`${base}/api/v1/usage?from=not-a-date`, { headers: bearer() });
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ error: { code: "validation_failed" } });
		for (const headers of [{}, bearer("invalid")])
			expect((await fetch(`${base}/api/v1/usage`, { headers })).status).toBe(401);
	});
});

describe("GET /api/v1/embedding-profiles", () => {
	it("returns public profile metadata and active profile only to read-authorized keys", async () => {
		const response = await fetch(`${base}/api/v1/embedding-profiles`, { headers: bearer() });
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			items: Array<{ id: string; active: boolean }>;
			active_profile: string | null;
			next_cursor: null;
		};
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.active_profile).toBe(body.items.find((item) => item.active)?.id ?? null);
		expect(body.next_cursor).toBeNull();
		expect(JSON.stringify(body)).not.toMatch(/vectorize_index|api_key|base_url/);
		expect(
			(await fetch(`${base}/api/v1/embedding-profiles`, { headers: bearer(writer.token) })).status,
		).toBe(403);
		expect((await fetch(`${base}/api/v1/embedding-profiles`)).status).toBe(401);
		const database = await e2eD1();
		await assertAsyncTestMarker(database);
		expect(
			await query<{ n: number }>(
				database,
				`SELECT count(*) AS n FROM usage_daily WHERE key_id = ${sqlText(reader.id)}`,
			),
		).toEqual([{ n: 2 }]);
	});
});
