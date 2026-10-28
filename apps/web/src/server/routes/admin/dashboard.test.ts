import { afterEach, describe, expect, it } from "vitest";
import { queryFixture } from "../../audit/__tests__/queries";
import type { DashboardPayload } from "../../dashboard/query";
import { resolveRange } from "../../dashboard/query";
import { adminDashboardRoutes } from "./dashboard";

const active: ReturnType<typeof queryFixture>[] = [];
afterEach(async () => {
	for (const fixtureData of active.splice(0)) {
		await fixtureData.flush();
		fixtureData.sqlite.close();
	}
});

function at(day: string, hour = 0): number {
	return Date.parse(`${day}T00:00:00.000Z`) + hour * 3_600_000;
}

function fixture() {
	const fixtureData = queryFixture();
	fixtureData.app.route("/api/admin/dashboard", adminDashboardRoutes());
	fixtureData.sqlite.exec(`
		INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, created_at, updated_at, revoked_at)
		VALUES
			('AAAAAAAAAAAA', '知识采集助手', 'hash', 'project', 'r,w', 'spaces', 0, 0, NULL),
			('BBBBBBBBBBBB', '旧助手', 'hash', 'drop', 'r', 'spaces', 0, 0, 1770000000000);
		INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at)
		VALUES
			('m1', 'space:kb', 'a', 'a', 'fact', 'AAAAAAAAAAAA', 'h', 0, 0, NULL),
			('m2', 'space:kb', 'b', 'b', 'note', 'AAAAAAAAAAAA', 'h', 0, 0, NULL),
			('m3', 'space:kb', 'c', 'c', 'fact', 'AAAAAAAAAAAA', 'h', 0, 0, 1770000000000),
			('m4', 'space:s', 'd', 'd', 'decision', 'AAAAAAAAAAAA', 'h', 0, 0, NULL);
		INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES
			('memory', 'm1', 'space:kb', 'created', 1, 'key:AAAAAAAAAAAA', ${at("2026-10-16")}),
			('memory', 'm1', 'space:kb', 'updated', 2, 'key:AAAAAAAAAAAA', ${at("2026-10-16", 3)}),
			('memory', 'm2', 'space:kb', 'created', 1, 'admin:person@example.com', ${at("2026-10-17")}),
			('memory', 'm2', 'space:s', 'moved', 2, 'key:BBBBBBBBBBBB', ${at("2026-10-17")}),
			('memory', 'm2', 'space:s', 'trashed', 3, 'key:AAAAAAAAAAAA', ${at("2026-10-18")}),
			('tag', 'tag:1', NULL, 'tag_renamed', NULL, 'key:AAAAAAAAAAAA', ${at("2026-10-18")}),
			('memory', 'm2', 'space:s', 'purged', 4, 'key:AAAAAAAAAAAA', ${at("2026-10-19")}),
			('memory', 'm2', 'space:s', 'created', 1, 'key:AAAAAAAAAAAA', ${at("2026-10-01")});
		INSERT INTO usage_daily (day, key_id, calls, errors, writes) VALUES
			('2026-10-17', 'AAAAAAAAAAAA', 4, 1, 2),
			('2026-10-17', 'BBBBBBBBBBBB', 1, 0, 0),
			('2026-10-01', 'AAAAAAAAAAAA', 9, 0, 3);
	`);
	active.push(fixtureData);
	return {
		...fixtureData,
		get: async (query = "") => {
			const response = await fixtureData.app.request(
				`http://localhost/api/admin/dashboard${query}`,
				{},
				fixtureData.env,
				fixtureData.ctx,
			);
			return { response, body: (await response.clone().json()) as DashboardPayload };
		},
	};
}

describe("admin dashboard aggregates", () => {
	it("returns range-scoped operations, usage, type and space counts", async () => {
		const fixtureData = fixture();
		const { response, body } = await fixtureData.get("?from=2026-10-16&to=2026-10-19");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(body.range).toEqual({ from: "2026-10-16", to: "2026-10-19", days: 4 });
		expect(body.ops).toEqual([
			{
				day: "2026-10-16",
				actor: "key:AAAAAAAAAAAA",
				space_id: "space:kb",
				op: "created",
				count: 1,
			},
			{
				day: "2026-10-16",
				actor: "key:AAAAAAAAAAAA",
				space_id: "space:kb",
				op: "updated",
				count: 1,
			},
			{
				day: "2026-10-17",
				actor: "admin:person@example.com",
				space_id: "space:kb",
				op: "created",
				count: 1,
			},
			{ day: "2026-10-17", actor: "key:BBBBBBBBBBBB", space_id: "space:s", op: "moved", count: 1 },
			{
				day: "2026-10-18",
				actor: "key:AAAAAAAAAAAA",
				space_id: "space:s",
				op: "trashed",
				count: 1,
			},
			{ day: "2026-10-19", actor: "key:AAAAAAAAAAAA", space_id: "space:s", op: "purged", count: 1 },
		]);
		expect(body.usage).toEqual([
			{ day: "2026-10-17", key_id: "AAAAAAAAAAAA", calls: 4, errors: 1, writes: 2 },
			{ day: "2026-10-17", key_id: "BBBBBBBBBBBB", calls: 1, errors: 0, writes: 0 },
		]);
		expect(body.totals).toEqual({ memories: 3, trash: 1, spaces: 4, keys: 2 });
		expect(body.spaces).toEqual([
			{ id: "space:dest", slug: "dest", name: "dest", memories: 0, trash: 0 },
			{ id: "space:kb", slug: "kb", name: "kb", memories: 2, trash: 1 },
			{ id: "space:other", slug: "other", name: "other", memories: 0, trash: 0 },
			{ id: "space:s", slug: "s", name: "s", memories: 1, trash: 0 },
		]);
		expect(body.types).toEqual(
			expect.arrayContaining([
				{ space_id: "space:kb", type: "fact", count: 1 },
				{ space_id: "space:kb", type: "note", count: 1 },
				{ space_id: "space:s", type: "decision", count: 1 },
			]),
		);
		expect(body.keys).toEqual([
			{
				id: "BBBBBBBBBBBB",
				name: "旧助手",
				role: "drop",
				revoked: true,
				last_used_at: null,
			},
			{
				id: "AAAAAAAAAAAA",
				name: "知识采集助手",
				role: "project",
				revoked: false,
				last_used_at: null,
			},
		]);
		expect(JSON.stringify(body)).not.toContain("hash");
	});

	it("defaults to the last 30 UTC days ending today", async () => {
		const fixtureData = fixture();
		const { body } = await fixtureData.get("?to=2026-10-19");
		expect(body.range).toEqual({ from: "2026-09-20", to: "2026-10-19", days: 30 });
	});

	it.each([
		"from=2026-10-20&to=2026-10-19",
		"from=2026-02-30",
		"to=2026-10-19T00:00:00Z",
		"from=2024-01-01&to=2026-10-19",
		"from=2026-10-19&from=2026-10-19",
		"unknown=1",
	])("rejects invalid ranges %s", async (query) => {
		const { response } = await fixture().get(`?${query}`);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
	});

	it("requires Access authentication", async () => {
		const fixtureData = fixture();
		delete fixtureData.env.ACCESS_DEV_BYPASS_EMAIL;
		const response = await fixtureData.app.request(
			"http://localhost/api/admin/dashboard",
			{},
			fixtureData.env,
			fixtureData.ctx,
		);
		expect(response.status).toBe(401);
	});
});

describe("dashboard range resolution", () => {
	it("counts inclusive UTC days and rejects ranges longer than a quarter", () => {
		const now = Date.parse("2026-10-19T12:00:00.000Z");
		expect(resolveRange(undefined, undefined, now)).toEqual({
			from: "2026-09-20",
			to: "2026-10-19",
			days: 30,
		});
		expect(resolveRange("2026-10-19", "2026-10-19", now).days).toBe(1);
		expect(resolveRange("2026-07-22", "2026-10-19", now).days).toBe(90);
		expect(() => resolveRange("2026-07-21", "2026-10-19", now)).toThrow("invalid time range");
	});
});
