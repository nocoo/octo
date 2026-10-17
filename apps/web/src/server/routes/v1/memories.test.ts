import { describe, expect, it } from "vitest";
import { mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";
import { insertSpace, insertTinyProfile, openTestD1 } from "../../repo/__tests__/sqlite-d1";

const pepper = "pepper";

async function boot(
	ops = "r,w,u,d",
	scope: "all" | "spaces" | "own" = "all",
	spaceIds: string[] = [],
) {
	const db = openTestD1();
	await insertSpace(db, { id: "s1", slug: "kb-bot" });
	await insertSpace(db, { id: "s2", slug: "other" });
	await insertTinyProfile(db);
	const minted = await mintApiKey(db, pepper, {
		name: `bot-${ops}-${scope}`,
		role: "custom",
		ops,
		scope,
		spaceIds,
	});
	const env: Env = {
		DB: db,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: pepper,
	};
	return { db, env, token: minted.plaintext, app: createApp() };
}

function auth(token: string, extra: Record<string, string> = {}) {
	return { Authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}

describe("memory v1 routes", () => {
	it("creates, gets, lists, patches, diffs, rollbacks, and trashes", async () => {
		const { app, env, token } = await boot();
		const created = await app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "Caddy",
					body: "line1\nline2\n",
					type: "procedure",
					tags: ["Infra"],
					importance: 0.8,
					vector: { profile: "tiny-3", values: [0, 1, 0] },
				}),
			},
			env,
		);
		expect(created.status).toBe(201);
		const item = (await created.json()) as { id: string; version: number; tags: string[] };
		expect(item.tags).toEqual(["infra"]);
		expect(item.version).toBe(1);

		const got = await app.request(
			`/api/v1/memories/${item.id}?include=versions_count,attachments,vector_status`,
			{ headers: auth(token) },
			env,
		);
		expect(got.status).toBe(200);
		expect(await got.json()).toMatchObject({
			id: item.id,
			versions_count: 1,
			attachments: [],
			vector_status: [{ profile: "tiny-3", indexed: false, stale: false }],
		});

		const patched = await app.request(
			`/api/v1/memories/${item.id}`,
			{
				method: "PATCH",
				headers: auth(token, { "If-Match": "1" }),
				body: JSON.stringify({ title: "Caddy 2", body: "line1\nline3\n", tags: ["ops"] }),
			},
			env,
		);
		expect(patched.status).toBe(200);
		expect(await patched.json()).toMatchObject({ version: 2, title: "Caddy 2" });

		const conflict = await app.request(
			`/api/v1/memories/${item.id}`,
			{
				method: "PATCH",
				headers: auth(token, { "If-Match": "1" }),
				body: JSON.stringify({ title: "nope" }),
			},
			env,
		);
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({
			error: { code: "version_conflict", details: { current_version: 2 } },
		});

		const versions = await app.request(
			`/api/v1/memories/${item.id}/versions`,
			{ headers: auth(token) },
			env,
		);
		expect(await versions.json()).toMatchObject({ items: [{ version: 1 }, { version: 2 }] });
		const v1 = await app.request(
			`/api/v1/memories/${item.id}/versions/1`,
			{ headers: auth(token) },
			env,
		);
		expect(await v1.json()).toMatchObject({ version: 1, body: "line1\nline2\n" });

		const diff = await app.request(
			`/api/v1/memories/${item.id}/diff?from=1&to=2`,
			{ headers: auth(token) },
			env,
		);
		const diffBody = (await diff.json()) as {
			body: { unified: string };
			fields: Array<{ field: string }>;
		};
		expect(diffBody.body.unified).toContain("-line2");
		expect(diffBody.fields.some((field) => field.field === "title")).toBe(true);

		const rolled = await app.request(
			`/api/v1/memories/${item.id}/rollback`,
			{
				method: "POST",
				headers: auth(token, { "If-Match": "2" }),
				body: JSON.stringify({ to_version: 1 }),
			},
			env,
		);
		expect(await rolled.json()).toMatchObject({ version: 3, title: "Caddy", tags: ["infra"] });

		const moved = await app.request(
			`/api/v1/memories/${item.id}`,
			{
				method: "PATCH",
				headers: auth(token, { "If-Match": "3" }),
				body: JSON.stringify({ space: "other" }),
			},
			env,
		);
		expect(await moved.json()).toMatchObject({ space: "other", version: 4 });

		const listed = await app.request(
			"/api/v1/memories?spaces=other&types=procedure",
			{
				headers: auth(token),
			},
			env,
		);
		expect(await listed.json()).toMatchObject({ items: [{ id: item.id }], next_cursor: null });

		const deleted = await app.request(
			`/api/v1/memories/${item.id}`,
			{ method: "DELETE", headers: auth(token) },
			env,
		);
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toMatchObject({ trashed_at: expect.any(String) });
		const missing = await app.request(`/api/v1/memories/${item.id}`, { headers: auth(token) }, env);
		expect(missing.status).toBe(404);

		const trash = await app.request("/api/v1/trash", { headers: auth(token) }, env);
		expect(await trash.json()).toMatchObject({ items: [{ id: item.id }] });
		const restored = await app.request(
			`/api/v1/trash/${item.id}/restore`,
			{ method: "POST", headers: auth(token) },
			env,
		);
		const restoredBody = (await restored.json()) as { version: number; deleted_at?: string };
		expect(restoredBody.version).toBe(5);
		expect(restoredBody.deleted_at).toBeUndefined();

		const changes = await app.request("/api/v1/changes", { headers: auth(token) }, env);
		const feed = (await changes.json()) as { items: Array<{ op: string }> };
		expect(feed.items.map((row) => row.op)).toContain("created");
		expect(feed.items.map((row) => row.op)).toContain("trashed");
		const head = await app.request("/api/v1/changes/head", { headers: auth(token) }, env);
		expect(await head.json()).toMatchObject({ cursor: expect.any(String) });
	});

	it("enforces authz, validation, payload size, and unknown space", async () => {
		const reader = await boot("r", "spaces", ["s1"]);
		const deniedWrite = await reader.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(reader.token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "b",
					type: "note",
					tags: [],
				}),
			},
			reader.env,
		);
		expect(deniedWrite.status).toBe(403);

		const writer = await boot("w", "all");
		const created = await writer.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(writer.token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "b",
					type: "note",
					tags: [],
				}),
			},
			writer.env,
		);
		expect(created.status).toBe(201);
		const item = (await created.json()) as { id: string };
		const cannotRead = await writer.app.request(
			`/api/v1/memories/${item.id}`,
			{
				headers: auth(writer.token),
			},
			writer.env,
		);
		expect(cannotRead.status).toBe(403);

		const hidden = await reader.app.request(
			"/api/v1/memories/nope",
			{ headers: auth(reader.token) },
			reader.env,
		);
		expect(hidden.status).toBe(404);

		const admin = await boot();
		const unknownSpace = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(admin.token),
				body: JSON.stringify({
					space: "missing",
					title: "t",
					body: "b",
					type: "note",
					tags: [],
				}),
			},
			admin.env,
		);
		expect(unknownSpace.status).toBe(404);

		const badJson = await admin.app.request(
			"/api/v1/memories",
			{ method: "POST", headers: auth(admin.token), body: "nope" },
			admin.env,
		);
		expect(badJson.status).toBe(400);

		const huge = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(admin.token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "x",
					type: "note",
					tags: [],
				}),
			},
			admin.env,
		);
		expect(huge.status).toBe(201);

		const noMatch = await admin.app.request(
			`/api/v1/memories/${((await huge.json()) as { id: string }).id}`,
			{
				method: "PATCH",
				headers: auth(admin.token),
				body: JSON.stringify({ title: "z" }),
			},
			admin.env,
		);
		expect(noMatch.status).toBe(400);

		const unauth = await admin.app.request("/api/v1/memories", {}, admin.env);
		expect(unauth.status).toBe(401);

		const badDiff = await admin.app.request(
			"/api/v1/memories/x/diff",
			{
				headers: auth(admin.token),
			},
			admin.env,
		);
		expect(badDiff.status).toBe(400);

		const badVersion = await admin.app.request(
			"/api/v1/memories/x/versions/nope",
			{
				headers: auth(admin.token),
			},
			admin.env,
		);
		expect(badVersion.status).toBe(400);

		const dim = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(admin.token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "b",
					type: "note",
					tags: [],
					vector: { profile: "tiny-3", values: [1] },
				}),
			},
			admin.env,
		);
		expect(dim.status).toBe(400);
		expect(await dim.json()).toMatchObject({ error: { code: "vector_dimension_mismatch" } });
	});

	it("hides out-of-scope spaces and supports include=trashed", async () => {
		const admin = await boot();
		const created = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(admin.token),
				body: JSON.stringify({
					space: "other",
					title: "secret",
					body: "b",
					type: "note",
					tags: ["x"],
				}),
			},
			admin.env,
		);
		const item = (await created.json()) as { id: string };
		await admin.app.request(
			`/api/v1/memories/${item.id}`,
			{ method: "DELETE", headers: auth(admin.token) },
			admin.env,
		);
		const limited = await mintApiKey(admin.db, pepper, {
			name: "limited",
			role: "custom",
			ops: "r,d",
			scope: "spaces",
			spaceIds: ["s1"],
		});
		const listed = await admin.app.request(
			"/api/v1/memories",
			{ headers: auth(limited.plaintext) },
			admin.env,
		);
		expect(await listed.json()).toMatchObject({ items: [] });
		const trash = await admin.app.request(
			"/api/v1/trash",
			{ headers: auth(limited.plaintext) },
			admin.env,
		);
		expect(await trash.json()).toMatchObject({ items: [] });
		const peek = await admin.app.request(
			`/api/v1/memories/${item.id}?include=trashed`,
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(peek.status).toBe(200);
		const listFilters = await admin.app.request(
			"/api/v1/memories?include=trashed&tags_all=missing&tags_any=x&sources=nope&time_field=created&time_from=2020-01-01T00:00:00Z&time_to=2030-01-01T00:00:00Z&importance_min=0&importance_max=1&limit=10",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(listFilters.status).toBe(200);
		const badCursor = await admin.app.request(
			"/api/v1/memories?cursor=!!!",
			{
				headers: auth(admin.token),
			},
			admin.env,
		);
		expect(badCursor.status).toBe(400);
		const restoreLive = await admin.app.request(
			"/api/v1/trash/nope/restore",
			{ method: "POST", headers: auth(admin.token) },
			admin.env,
		);
		expect(restoreLive.status).toBe(404);
		const writer = await mintApiKey(admin.db, pepper, {
			name: "writer",
			role: "drop",
			ops: "w",
			scope: "all",
		});
		const noRead = await admin.app.request(
			"/api/v1/changes",
			{
				headers: auth(writer.plaintext),
			},
			admin.env,
		);
		expect(noRead.status).toBe(403);
		const noTrash = await mintApiKey(admin.db, pepper, {
			name: "reader",
			role: "readonly",
			ops: "r",
			scope: "all",
		});
		const includeDenied = await admin.app.request(
			"/api/v1/memories?include=trashed",
			{
				headers: auth(noTrash.plaintext),
			},
			admin.env,
		);
		expect(includeDenied.status).toBe(403);
		const created2 = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(admin.token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "b",
					type: "note",
					tags: [],
					event_time: "2026-01-01T00:00:00Z",
				}),
			},
			admin.env,
		);
		expect(created2.status).toBe(201);
		const live = (await created2.json()) as { id: string };
		const cleared = await admin.app.request(
			`/api/v1/memories/${live.id}`,
			{
				method: "PATCH",
				headers: auth(admin.token, { "If-Match": "1" }),
				body: JSON.stringify({ event_time: null, vector: null, expected_version: 1 }),
			},
			admin.env,
		);
		expect(cleared.status).toBe(200);
		const missingVersion = await admin.app.request(
			`/api/v1/memories/${live.id}/rollback`,
			{
				method: "POST",
				headers: auth(admin.token, { "If-Match": "2" }),
				body: JSON.stringify({ to_version: 99 }),
			},
			admin.env,
		);
		expect(missingVersion.status).toBe(422);
		const changes = await admin.app.request(
			"/api/v1/changes?spaces=kb-bot&limit=5",
			{
				headers: auth(admin.token),
			},
			admin.env,
		);
		expect(changes.status).toBe(200);
		const head = await admin.app.request(
			"/api/v1/changes/head?spaces=kb-bot",
			{
				headers: auth(admin.token),
			},
			admin.env,
		);
		expect(head.status).toBe(200);
	});

	it("covers empty csv, one-sided filters, payload size, and own trash", async () => {
		const admin = await boot();
		const created = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(admin.token),
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "b",
					type: "note",
					tags: ["infra"],
				}),
			},
			admin.env,
		);
		const item = (await created.json()) as { id: string; version: number };
		const emptyCsv = await admin.app.request(
			"/api/v1/memories?spaces=&tags_all=&tags_any=,&types=&sources=&limit=",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(emptyCsv.status).toBe(200);
		const sided = await admin.app.request(
			"/api/v1/memories?time_field=updated&time_to=2030-01-01T00:00:00.000Z&importance_max=1&spaces=missing,kb-bot",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(sided.status).toBe(200);
		expect(((await sided.json()) as { items: unknown[] }).items).toHaveLength(1);
		const sameSpace = await admin.app.request(
			`/api/v1/memories/${item.id}`,
			{
				method: "PATCH",
				headers: auth(admin.token, { "If-Match": "1" }),
				body: JSON.stringify({ space: "kb-bot" }),
			},
			admin.env,
		);
		expect(sameSpace.status).toBe(200);
		const huge = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: { ...auth(admin.token), "content-length": "2000000" },
				body: JSON.stringify({
					space: "kb-bot",
					title: "t",
					body: "b",
					type: "note",
					tags: [],
				}),
			},
			admin.env,
		);
		expect(huge.status).toBe(413);
		const missingSnap = await admin.app.request(
			`/api/v1/memories/${item.id}/versions/99`,
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(missingSnap.status).toBe(404);
		const missingDiff = await admin.app.request(
			`/api/v1/memories/${item.id}/diff?from=1&to=99`,
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(missingDiff.status).toBe(422);
		const liveRestore = await admin.app.request(
			`/api/v1/trash/${item.id}/restore`,
			{ method: "POST", headers: auth(admin.token) },
			admin.env,
		);
		expect(liveRestore.status).toBe(404);
		const writer = await mintApiKey(admin.db, pepper, {
			name: "w",
			role: "drop",
			ops: "w",
			scope: "all",
		});
		const noHead = await admin.app.request(
			"/api/v1/changes/head",
			{ headers: auth(writer.plaintext) },
			admin.env,
		);
		expect(noHead.status).toBe(403);
		const emptySpaces = await admin.app.request(
			"/api/v1/changes?spaces=&spaces2=",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(emptySpaces.status).toBe(200);
		const commaSpaces = await admin.app.request(
			"/api/v1/changes?spaces=,,,",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(commaSpaces.status).toBe(200);
		const commaHead = await admin.app.request(
			"/api/v1/changes/head?spaces=,,,",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(commaHead.status).toBe(200);
		const emptyHead = await admin.app.request(
			"/api/v1/changes/head?spaces=",
			{ headers: auth(admin.token) },
			admin.env,
		);
		expect(emptyHead.status).toBe(200);
		const own = await mintApiKey(admin.db, pepper, {
			name: "own",
			role: "custom",
			ops: "r,w,u,d",
			scope: "all",
			ownEntriesOnly: true,
		});
		const ownCreated = await admin.app.request(
			"/api/v1/memories",
			{
				method: "POST",
				headers: auth(own.plaintext),
				body: JSON.stringify({
					space: "kb-bot",
					title: "mine",
					body: "b",
					type: "note",
					tags: [],
				}),
			},
			admin.env,
		);
		const ownItem = (await ownCreated.json()) as { id: string };
		await admin.app.request(
			`/api/v1/memories/${item.id}`,
			{ method: "DELETE", headers: auth(admin.token) },
			admin.env,
		);
		await admin.app.request(
			`/api/v1/memories/${ownItem.id}`,
			{ method: "DELETE", headers: auth(own.plaintext) },
			admin.env,
		);
		const ownTrash = await admin.app.request(
			"/api/v1/trash",
			{ headers: auth(own.plaintext) },
			admin.env,
		);
		expect(await ownTrash.json()).toMatchObject({ items: [{ id: ownItem.id }] });
		const includeEmpty = await admin.app.request(
			`/api/v1/memories/${ownItem.id}?include=`,
			{ headers: auth(own.plaintext) },
			admin.env,
		);
		expect(includeEmpty.status).toBe(404);
		const noList = await admin.app.request(
			"/api/v1/memories",
			{ headers: auth(writer.plaintext) },
			admin.env,
		);
		expect(noList.status).toBe(403);
	});
});
