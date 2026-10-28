import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, seedSpace, sqlText } from "../fixtures/l2-batch";

let key: Awaited<ReturnType<typeof seedKey>>;
let space: Awaited<ReturnType<typeof seedSpace>>;
let adminJwt = "";
const prefix = `dashboard-${crypto.randomUUID()}`;
const day = "2020-01-02";
const at = Date.parse(`${day}T04:00:00.000Z`);

type Dashboard = {
	range: { from: string; to: string; days: number };
	totals: { memories: number; trash: number; spaces: number; keys: number };
	ops: Array<{ day: string; actor: string; space_id: string; op: string; count: number }>;
	usage: Array<{ day: string; key_id: string; calls: number; errors: number; writes: number }>;
	types: Array<{ space_id: string; type: string; count: number }>;
	spaces: Array<{ id: string; slug: string; name: string; memories: number; trash: number }>;
	keys: Array<{ id: string; name: string; role: string; revoked: boolean }>;
};

beforeAll(async () => {
	const database = await e2eD1();
	await assertAsyncTestMarker(database);
	key = await seedKey(database);
	space = await seedSpace(database);
	adminJwt = await signAccessJwt(await loadJwksState(), {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "dashboard-l2@local",
	});
	await database([
		"--command",
		`INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at)
		VALUES
			(${sqlText(`${prefix}-a`)}, ${sqlText(space.id)}, 'a', 'a', 'fact', ${sqlText(key.id)}, 'h', 0, 0, NULL),
			(${sqlText(`${prefix}-b`)}, ${sqlText(space.id)}, 'b', 'b', 'fact', ${sqlText(key.id)}, 'h', 0, 0, NULL),
			(${sqlText(`${prefix}-c`)}, ${sqlText(space.id)}, 'c', 'c', 'note', ${sqlText(key.id)}, 'h', 0, 0, 1);
		INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES
			('memory', ${sqlText(`${prefix}-a`)}, ${sqlText(space.id)}, 'created', 1, ${sqlText(`key:${key.id}`)}, ${at}),
			('memory', ${sqlText(`${prefix}-a`)}, ${sqlText(space.id)}, 'updated', 2, ${sqlText(`key:${key.id}`)}, ${at + 1}),
			('memory', ${sqlText(`${prefix}-b`)}, ${sqlText(space.id)}, 'trashed', 2, ${sqlText(`key:${key.id}`)}, ${at + 2});
		INSERT INTO usage_daily (day, key_id, calls, errors, writes) VALUES
			(${sqlText(day)}, ${sqlText(key.id)}, 5, 2, 3);`,
	]);
});

afterAll(async () => {
	if (!key || !space) return;
	const database = await e2eD1();
	await assertAsyncTestMarker(database);
	await database([
		"--command",
		`DELETE FROM changes WHERE actor = ${sqlText(`key:${key.id}`)};
		DELETE FROM memories WHERE id LIKE ${sqlText(`${prefix}%`)};
		DELETE FROM usage_daily WHERE key_id = ${sqlText(key.id)};
		DELETE FROM api_keys WHERE id = ${sqlText(key.id)};
		DELETE FROM spaces WHERE id = ${sqlText(space.id)};`,
	]);
});

function get(path: string, headers: Record<string, string> = {}) {
	return fetch(`${base}/api/admin/dashboard${path}`, { headers });
}

describe("GET /api/admin/dashboard", () => {
	it("aggregates operations, usage, types and spaces for the requested UTC window", async () => {
		const response = await get(`?from=${day}&to=${day}`, {
			"Cf-Access-Jwt-Assertion": adminJwt,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const body = (await response.json()) as Dashboard;
		expect(body.range).toEqual({ from: day, to: day, days: 1 });
		expect(body.ops.filter((row) => row.space_id === space.id)).toEqual([
			{ day, actor: `key:${key.id}`, space_id: space.id, op: "created", count: 1 },
			{ day, actor: `key:${key.id}`, space_id: space.id, op: "trashed", count: 1 },
			{ day, actor: `key:${key.id}`, space_id: space.id, op: "updated", count: 1 },
		]);
		expect(body.usage.filter((row) => row.key_id === key.id)).toEqual([
			{ day, key_id: key.id, calls: 5, errors: 2, writes: 3 },
		]);
		expect(body.types.filter((row) => row.space_id === space.id)).toEqual([
			{ space_id: space.id, type: "fact", count: 2 },
		]);
		expect(body.spaces.find((row) => row.id === space.id)).toEqual({
			id: space.id,
			slug: space.slug,
			name: space.slug,
			memories: 2,
			trash: 1,
		});
		expect(body.keys.find((row) => row.id === key.id)).toMatchObject({
			name: `e2e-${key.id}`,
			role: "admin",
			revoked: false,
		});
		expect(body.totals.memories).toBeGreaterThanOrEqual(2);
		expect(body.totals.trash).toBeGreaterThanOrEqual(1);
		expect(body.totals.spaces).toBeGreaterThanOrEqual(1);
		expect(JSON.stringify(body)).not.toContain(key.token);
		expect(JSON.stringify(body)).not.toContain("secret_hash");
	});

	it("rejects invalid windows and never accepts an API key", async () => {
		const headers = { "Cf-Access-Jwt-Assertion": adminJwt };
		for (const path of ["?from=2020-01-03&to=2020-01-02", "?from=2019-01-01&to=2020-01-02"]) {
			const response = await get(path, headers);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
		}
		for (const auth of [{}, { Authorization: `Bearer ${key.token}` }]) {
			const response = await get("", auth);
			expect(response.status).toBe(401);
		}
	});

	it("records the dashboard call in the audit log without keys", async () => {
		await get("?from=2020-01-02&to=2020-01-02", { "Cf-Access-Jwt-Assertion": adminJwt });
		const database = await e2eD1();
		const rows = await query<{ actor: string; route: string; status: number }>(
			database,
			`SELECT actor, route, status FROM audit_log WHERE actor = 'admin:dashboard-l2@local' ORDER BY at DESC LIMIT 1`,
		);
		expect(rows).toEqual([
			{ actor: "admin:dashboard-l2@local", route: "/api/admin/dashboard", status: 200 },
		]);
	});
});
