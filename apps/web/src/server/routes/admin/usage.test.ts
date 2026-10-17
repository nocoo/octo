import { afterEach, describe, expect, it } from "vitest";
import { queryFixture } from "../../audit/__tests__/queries";
import { adminUsageRoutes } from "./usage";

const active: ReturnType<typeof queryFixture>[] = [];
afterEach(async () => {
	for (const fixtureData of active.splice(0)) {
		await fixtureData.flush();
		fixtureData.sqlite.close();
	}
});
function fixture() {
	const fixtureData = queryFixture();
	fixtureData.app.route("/api/admin/usage", adminUsageRoutes());
	fixtureData.sqlite.exec(`INSERT INTO usage_daily (day,key_id,calls,errors,writes,bytes_in,bytes_out) VALUES
	('2026-10-16','AAAAAAAAAAAA',1,0,0,2,3),
	('2026-10-17','AAAAAAAAAAAA',4,1,1,5,6),
	('2026-10-17','BBBBBBBBBBBB',7,0,0,8,9),
	('2026-10-18','AAAAAAAAAAAA',10,0,0,11,12)`);
	active.push(fixtureData);
	return {
		...fixtureData,
		get: (query = "") =>
			fixtureData.app.request(
				`http://localhost/api/admin/usage${query}`,
				{},
				fixtureData.env,
				fixtureData.ctx,
			),
	};
}

describe("admin daily usage", () => {
	it("lists per-day/per-key rows and filters inclusive UTC days and key", async () => {
		const fixtureData = fixture();
		const all = (await (await fixtureData.get()).json()) as {
			items: Array<{ day: string; key_id: string }>;
			next_cursor: string | null;
		};
		expect(all.items.map((row) => [row.day, row.key_id])).toEqual([
			["2026-10-18", "AAAAAAAAAAAA"],
			["2026-10-17", "BBBBBBBBBBBB"],
			["2026-10-17", "AAAAAAAAAAAA"],
			["2026-10-16", "AAAAAAAAAAAA"],
		]);
		expect(all.next_cursor).toBeNull();
		expect(
			await (await fixtureData.get("?from=2026-10-17&to=2026-10-17&key_id=AAAAAAAAAAAA")).json(),
		).toEqual({
			items: [
				{
					day: "2026-10-17",
					key_id: "AAAAAAAAAAAA",
					calls: 4,
					errors: 1,
					writes: 1,
					bytes_in: 5,
					bytes_out: 6,
				},
			],
			next_cursor: null,
		});
		expect(await (await fixtureData.get("?key_id=CCCCCCCCCCCC")).json()).toEqual({
			items: [],
			next_cursor: null,
		});
	});

	it("paginates ties without duplicates and binds cursor to effective filters", async () => {
		const fixtureData = fixture();
		const first = (await (await fixtureData.get("?limit=2")).json()) as { next_cursor: string };
		expect(first.next_cursor).toBeTypeOf("string");
		const next = (await (await fixtureData.get(`?limit=2&cursor=${first.next_cursor}`)).json()) as {
			items: Array<{ day: string; key_id: string }>;
			next_cursor: string | null;
		};
		expect(next.items.map((row) => [row.day, row.key_id])).toEqual([
			["2026-10-17", "AAAAAAAAAAAA"],
			["2026-10-16", "AAAAAAAAAAAA"],
		]);
		expect(next.next_cursor).toBeNull();
		expect((await fixtureData.get(`?key_id=AAAAAAAAAAAA&cursor=${first.next_cursor}`)).status).toBe(
			400,
		);
		expect((await fixtureData.get(`?cursor=${first.next_cursor}x`)).status).toBe(400);
	});

	it.each([
		"from=2026-02-30",
		"to=2026-10-17T00:00:00Z",
		"from=2026-10-18&to=2026-10-17",
		"key_id=bad",
		"key_id=",
		"limit=201",
		"from=2026-10-17&from=2026-10-17",
		"unknown=1",
	])("rejects invalid filters %s", async (query) => {
		const res = await fixture().get(`?${query}`);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } });
	});

	it("requires Access authentication", async () => {
		const fixtureData = fixture();
		delete fixtureData.env.ACCESS_DEV_BYPASS_EMAIL;
		expect((await fixtureData.get()).status).toBe(401);
	});
});
