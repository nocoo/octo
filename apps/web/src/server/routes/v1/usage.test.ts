import { afterEach, describe, expect, it } from "vitest";
import { PEPPER } from "../../audit/__tests__/app";
import { queryFixture } from "../../audit/__tests__/queries";
import { mintApiKey } from "../../auth/api-key";
import { usageRoutes } from "./usage";

const active: ReturnType<typeof queryFixture>[] = [];
afterEach(async () => {
	for (const fixtureData of active.splice(0)) {
		await fixtureData.flush();
		fixtureData.sqlite.close();
	}
});
async function fixture() {
	const fixtureData = queryFixture();
	fixtureData.app.route("/api/v1/usage", usageRoutes());
	const own = await mintApiKey(fixtureData.db, PEPPER, {
		name: "drop",
		role: "drop",
		ops: "w",
		scope: "all",
	});
	const other = await mintApiKey(fixtureData.db, PEPPER, {
		name: "other",
		role: "admin",
		ops: "r,w,u,d",
		scope: "all",
	});
	for (const [day, id] of [
		["2026-10-17", own.row.id],
		["2026-10-16", own.row.id],
		["2026-10-17", other.row.id],
	])
		fixtureData.sqlite
			.prepare("INSERT INTO usage_daily(day,key_id,calls) VALUES(?,?,1)")
			.run(day as string, id as string);
	active.push(fixtureData);
	return {
		...fixtureData,
		own,
		other,
		get: (query = "", token: string | null = own.plaintext) =>
			fixtureData.app.request(
				`/api/v1/usage${query}`,
				{ headers: token ? { Authorization: `Bearer ${token}` } : {} },
				fixtureData.env,
				fixtureData.ctx,
			),
	};
}

describe("v1 usage", () => {
	it("returns only the caller even for malicious key_id and write-only keys", async () => {
		const fixtureData = await fixture();
		for (const query of [
			"",
			`?key_id=${fixtureData.other.row.id}`,
			"?key_id=%27%20OR%201=1--",
			"?key_id=",
		]) {
			const res = await fixtureData.get(query);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { items: Array<{ key_id: string }> };
			expect(body.items).toHaveLength(2);
			expect(body.items.every((row) => row.key_id === fixtureData.own.row.id)).toBe(true);
		}
		expect(await (await fixtureData.get("?from=2026-10-17&to=2026-10-17")).json()).toMatchObject({
			items: [{ day: "2026-10-17", key_id: fixtureData.own.row.id }],
			next_cursor: null,
		});
	});

	it("binds cursors to the authenticated caller, not user supplied key_id", async () => {
		const fixtureData = await fixture();
		const first = (await (await fixtureData.get("?limit=1")).json()) as { next_cursor: string };
		const second = await fixtureData.get(
			`?limit=1&key_id=${fixtureData.other.row.id}&cursor=${first.next_cursor}`,
		);
		expect(await second.json()).toMatchObject({
			items: [{ day: "2026-10-16", key_id: fixtureData.own.row.id }],
			next_cursor: null,
		});
		expect(
			(await fixtureData.get(`?cursor=${first.next_cursor}`, fixtureData.other.plaintext)).status,
		).toBe(400);
	});

	it("rejects missing/bad auth before invalid query parameters", async () => {
		const fixtureData = await fixture();
		for (const token of [null, "bad"])
			expect((await fixtureData.get("?limit=bad", token)).status).toBe(401);
		for (const query of ["?to=bad", "?limit=0", "?key_id=x&key_id=y", "?unknown=1"]) {
			const res = await fixtureData.get(query);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } });
		}
	});
});
