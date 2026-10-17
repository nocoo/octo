import { afterEach, describe, expect, it } from "vitest";
import { auditRow, queryFixture } from "../../audit/__tests__/queries";
import { adminAuditRoutes } from "./audit";

const active: ReturnType<typeof queryFixture>[] = [];
afterEach(async () => {
	for (const fixtureData of active.splice(0)) {
		await fixtureData.flush();
		fixtureData.sqlite.close();
	}
});
function fixture() {
	const fixtureData = queryFixture();
	fixtureData.app.route("/api/admin/audit", adminAuditRoutes());
	active.push(fixtureData);
	return {
		...fixtureData,
		get: (query = "") =>
			fixtureData.app.request(
				`http://localhost/api/admin/audit${query}`,
				{},
				fixtureData.env,
				fixtureData.ctx,
			),
	};
}

describe("admin audit query", () => {
	it("filters actor, exact normalized action, status and inclusive UTC days", async () => {
		const fixtureData = fixture();
		const time = Date.UTC(2026, 9, 17);
		for (const [id, at, actor, route, status] of [
			["a", time, "key:AAAAAAAAAAAA", "/api/v1/memories/:id", 403],
			["b", time + 86_400_000 - 1, "key:AAAAAAAAAAAA", "/api/v1/memories/:id", 403],
			["c", time + 86_400_000, "key:AAAAAAAAAAAA", "/api/v1/memories/:id", 403],
			["d", time, "anonymous", "/api/v1/memories/:id", 403],
			["e", time, "key:AAAAAAAAAAAA", "/api/v1/memories", 403],
			["f", time, "key:AAAAAAAAAAAA", "/api/v1/memories/:id", 200],
		] as const)
			auditRow(fixtureData.sqlite, { id, at, actor, route, status });
		const res = await fixtureData.get(
			"?from=2026-10-17&to=2026-10-17&actor=key:AAAAAAAAAAAA&action=/api/v1/memories/:id&status=403",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ id: string; at: string }>;
			next_cursor: string | null;
		};
		expect(body.items.map((row) => row.id)).toEqual(["b", "a"]);
		expect(body.items[0]?.at).toBe("2026-10-17T23:59:59.999Z");
		expect(body.next_cursor).toBeNull();
		expect(body.items[0]).toEqual({
			id: "b",
			at: "2026-10-17T23:59:59.999Z",
			actor: "key:AAAAAAAAAAAA",
			method: "GET",
			route: "/api/v1/memories/:id",
			status: 403,
			error_code: null,
			request_id: "request",
			duration_ms: 1,
			bytes_in: null,
			bytes_out: null,
			ip_hash: null,
		});
	});

	it("paginates tied timestamps stably with signed filter-bound cursors", async () => {
		const fixtureData = fixture();
		for (const id of ["a", "b", "c"]) auditRow(fixtureData.sqlite, { id });
		const first = (await (await fixtureData.get("?actor=key:AAAAAAAAAAAA&limit=2")).json()) as {
			items: Array<{ id: string }>;
			next_cursor: string;
		};
		expect(first.items.map((row) => row.id)).toEqual(["c", "b"]);
		expect(first.next_cursor).toBeTypeOf("string");
		auditRow(fixtureData.sqlite, { id: "d" });
		const next = await fixtureData.get(
			`?actor=key:AAAAAAAAAAAA&limit=2&cursor=${first.next_cursor}`,
		);
		expect(await next.json()).toMatchObject({ items: [{ id: "a" }], next_cursor: null });
		expect((await fixtureData.get(`?cursor=${first.next_cursor}`)).status).toBe(400);
		expect(
			(await fixtureData.get(`?actor=key:AAAAAAAAAAAA&cursor=${first.next_cursor}x`)).status,
		).toBe(400);
	});

	it("supports precise UTC timestamps, no-filter defaults and empty results", async () => {
		const fixtureData = fixture();
		auditRow(fixtureData.sqlite, { id: "a", at: Date.UTC(2026, 9, 17, 12) });
		const res = await fixtureData.get("?from=2026-10-17T12:00:00Z&to=2026-10-17T12:00:00.000Z");
		expect(await res.json()).toMatchObject({ items: [{ id: "a" }], next_cursor: null });
		expect((await fixtureData.get()).status).toBe(200);
		expect(await (await fixtureData.get("?actor=anonymous")).json()).toEqual({
			items: [],
			next_cursor: null,
		});
	});

	it("queries the safe marker for unmatched routes", async () => {
		const fixtureData = fixture();
		auditRow(fixtureData.sqlite, { id: "missing", route: "unmatched", status: 404 });
		const response = await fixtureData.get("?action=unmatched&status=404");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: [{ id: "missing", route: "unmatched" }],
			next_cursor: null,
		});
	});

	it.each([
		"from=2026-02-30",
		"to=yesterday",
		"from=2026-10-18&to=2026-10-17",
		"status=99",
		"status=600",
		"status=2xx",
		"status=200&status=403",
		"actor=key:bad",
		"action=GET",
		"action=/api?secret=key",
		"limit=0",
		"limit=201",
		"limit=1.5",
		"limit=",
		"cursor=not-a-cursor",
		"extra=1",
		"__proto__=unexpected",
	])("rejects invalid filters %s", async (query) => {
		const res = await fixture().get(`?${query}`);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: { code: "validation_failed", request_id: expect.any(String) },
		});
	});

	it("requires Access before query validation and does not expose storage errors", async () => {
		const fixtureData = fixture();
		delete fixtureData.env.ACCESS_DEV_BYPASS_EMAIL;
		expect((await fixtureData.get("?limit=bad")).status).toBe(401);
		fixtureData.env.ACCESS_DEV_BYPASS_EMAIL = "admin@example.com";
		fixtureData.sqlite.exec("DROP TABLE audit_log");
		const res = await fixtureData.get();
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain("audit_log");
	});
});
