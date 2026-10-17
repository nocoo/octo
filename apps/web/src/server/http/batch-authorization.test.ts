import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { AppVars, Env } from "../env";
import { toErrorResponse } from "../lib/errors";
import { BatchMemoryService } from "../services/batch-memories";
import { testApiPrincipal } from "../test-principal";
import { authorizeBatchReplay } from "./batch-authorization";

const databases: Array<ReturnType<typeof sqliteD1>["sqlite"]> = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

async function fixture() {
	const { db, sqlite } = sqliteD1();
	databases.push(sqlite);
	const principal = testApiPrincipal();
	const ctx = { db, principal, statements: [] as D1PreparedStatement[] };
	const row = await new BatchMemoryService().create(
		{ space: "kb", title: "t", body: "b", type: "note", tags: [] },
		ctx,
	);
	await db.batch(ctx.statements);
	const replay = (
		body: string,
		path = "/api/v1/memories:batchCreate",
		status = 200,
		method = "POST",
		payload: unknown = { items: [] },
	) => {
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.onError((err) => toErrorResponse(err, "test"));
		app.all("*", async (context) => {
			context.set("apiKey", principal);
			await authorizeBatchReplay(context, { status, body });
			return context.json({ authorized: true });
		});
		return app.request(
			path,
			{
				method,
				...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
			},
			{ DB: db } as Env,
		);
	};
	return { sqlite, row, replay };
}

describe("batch replay boundary", () => {
	it.each([
		["/api/v1/memories:batchCreate", "POST", 400],
		["/api/v1/search", "POST", 200],
		["/api/v1/memories:batchCreate", "GET", 200],
	] as const)("ignores %s %s with status %i", async (path, method, status) => {
		const scenario = await fixture();
		expect((await scenario.replay("not-json", path, status, method)).status).toBe(200);
	});

	it.each(["{", "{}", '{"results":[{"ok":"yes"}]}'])(
		"fails closed on corrupt cached envelope %s",
		async (body) => {
			const scenario = await fixture();
			const response = await scenario.replay(body);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
		},
	);

	it("rejects a cached success without an identity", async () => {
		const scenario = await fixture();
		expect((await scenario.replay(JSON.stringify({ results: [{ ok: true }] }))).status).toBe(503);
	});

	it.each(["space_id", "source_key_id"])(
		"rejects a cached success without snapshot %s",
		async (field) => {
			const scenario = await fixture();
			const snapshot: Record<string, unknown> = { ...scenario.row };
			delete snapshot[field];
			expect(
				(await scenario.replay(JSON.stringify({ results: [{ ok: true, item: snapshot }] }))).status,
			).toBe(404);
		},
	);

	it("rejects a hard-deleted memory instead of returning cached contents", async () => {
		const scenario = await fixture();
		scenario.sqlite.prepare("DELETE FROM memory_versions WHERE memory_id = ?").run(scenario.row.id);
		scenario.sqlite.prepare("DELETE FROM memories WHERE id = ?").run(scenario.row.id);
		expect(
			(await scenario.replay(JSON.stringify({ results: [{ ok: true, item: scenario.row }] })))
				.status,
		).toBe(404);
	});

	it("rejects a cached delete whose item index has no corresponding request identity", async () => {
		const scenario = await fixture();
		const response = await scenario.replay(
			JSON.stringify({ results: [{ ok: true }, { ok: true }] }),
			"/api/v1/memories:batchDelete",
			200,
			"POST",
			{ ids: [scenario.row.id] },
		);
		expect(response.status).toBe(503);
	});

	it("can replay an unchanged per-item version conflict without requiring successful contents", async () => {
		const scenario = await fixture();
		const response = await scenario.replay(
			JSON.stringify({ results: [{ ok: false, error: { code: "version_conflict" } }] }),
			"/api/v1/memories:batchUpdate",
			200,
			"POST",
			{ items: [{ id: scenario.row.id, expected_version: 2, title: "t" }] },
		);
		expect(response.status).toBe(200);
	});
});
