import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, sqlText } from "../fixtures/l2-batch";

let key: Awaited<ReturnType<typeof seedKey>>;
let other: Awaited<ReturnType<typeof seedKey>>;
let adminJwt = "";
const tagId = crypto.randomUUID();
const prefix = `usage-r3-${crypto.randomUUID()}`;

type UsageRow = {
	day: string;
	key_id: string;
	calls: number;
	errors: number;
	writes: number;
	bytes_in: number;
	bytes_out: number;
};
type UsagePage = { items: UsageRow[]; next_cursor: string | null };

beforeAll(async () => {
	const database = await e2eD1();
	await assertAsyncTestMarker(database);
	key = await seedKey(database);
	other = await seedKey(database);
	await database([
		"--command",
		`INSERT INTO tags (id,name,display_name,created_at,updated_at)
		VALUES (${sqlText(tagId)},${sqlText(prefix)},${sqlText(prefix)},0,0)`,
	]);
	const state = await loadJwksState();
	adminJwt = await signAccessJwt(state, {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "usage-r3@local",
	});
});

afterAll(async () => {
	if (!key || !other) return;
	const database = await e2eD1();
	await assertAsyncTestMarker(database);
	const ids = [key.id, other.id].map(sqlText).join(",");
	await database([
		"--command",
		`DELETE FROM tags WHERE id = ${sqlText(tagId)};
		DELETE FROM changes WHERE entity = 'tag' AND entity_id = ${sqlText(tagId)};
		DELETE FROM audit_log WHERE actor IN (${sqlText(`key:${key.id}`)},${sqlText(`key:${other.id}`)});
		DELETE FROM usage_daily WHERE key_id IN (${ids});
		DELETE FROM api_keys WHERE id IN (${ids});`,
	]);
});

describe("live usage through the local Worker", () => {
	it("counts more than 50 sequential writes and exact bytes for key and admin without cron", async () => {
		const headers = { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" };
		let currentName = prefix;
		let bytesIn = 0;
		let bytesOut = 0;
		for (let index = 0; index < 64; index++) {
			const newName = `${prefix}-${index}-咖啡`;
			const body = JSON.stringify({ new_name: newName });
			const response = await fetch(
				`${base}/api/v1/tags/${encodeURIComponent(currentName)}/rename`,
				{ method: "POST", headers, body },
			);
			expect(response.status).toBe(200);
			bytesIn += new TextEncoder().encode(body).byteLength;
			bytesOut += (await response.arrayBuffer()).byteLength;
			currentName = newName;
		}
		const database = await e2eD1();
		expect(
			await query(
				database,
				`SELECT count(*) AS n FROM audit_log WHERE actor = ${sqlText(`key:${key.id}`)}`,
			),
		).toEqual([{ n: 64 }]);
		const own = await fetch(`${base}/api/v1/usage?key_id=${other.id}`, { headers });
		expect(own.status).toBe(200);
		const ownBody = await own.text();
		const page = JSON.parse(ownBody) as UsagePage;
		expect(page.items).toEqual([
			{
				day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				key_id: key.id,
				calls: 64,
				errors: 0,
				writes: 64,
				bytes_in: bytesIn,
				bytes_out: bytesOut,
			},
		]);
		expect(page.next_cursor).toBeNull();
		await e2eD1();
		const admin = await fetch(`${base}/api/admin/usage?key_id=${key.id}`, {
			headers: { "Cf-Access-Jwt-Assertion": adminJwt },
		});
		expect(admin.status).toBe(200);
		expect((await admin.json()) as UsagePage).toEqual({
			items: [
				{
					...page.items[0],
					calls: 65,
					bytes_out: bytesOut + new TextEncoder().encode(ownBody).byteLength,
				},
			],
			next_cursor: null,
		});
		const hidden = await fetch(`${base}/api/v1/usage?key_id=${key.id}`, {
			headers: { Authorization: `Bearer ${other.token}` },
		});
		expect(hidden.status).toBe(200);
		expect(await hidden.json()).toEqual({ items: [], next_cursor: null });
	});
});
