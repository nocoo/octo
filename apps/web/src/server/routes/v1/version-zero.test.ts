import { afterEach, describe, expect, it } from "vitest";
import { setup } from "../../mcp/__tests__/app";
import { insertTinyProfile } from "../../repo/__tests__/sqlite-d1";
import { createAdminParityRoutes } from "../admin/parity";

const contexts: Awaited<ReturnType<typeof setup>>[] = [];
afterEach(async () => {
	for (const context of contexts.splice(0)) {
		await context.flush();
		context.sqlite.close();
	}
});

async function fixture(prefix = "/api/v1") {
	const context = await setup();
	contexts.push(context);
	await insertTinyProfile(context.db);
	context.app.route("/api/admin", createAdminParityRoutes());
	const env = {
		...context.env,
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "zero@local",
	};
	const request = (path: string, method: string, body: unknown, headers = {}) =>
		context.app.request(
			`${prefix}${path}`,
			{
				method,
				headers: {
					...context.headers,
					Origin: "https://octo.dev.hexly.ai",
					...headers,
				},
				body: JSON.stringify(body),
			},
			env,
			context.ctx,
		);
	const created = await request("/memories", "POST", {
		space: "kb",
		title: "original",
		body: "original body",
		type: "note",
		tags: [],
	});
	expect(created.status).toBe(201);
	const { id } = (await created.json()) as { id: string };
	const unchanged = () => {
		expect(
			context.sqlite.prepare("SELECT title, version FROM memories WHERE id = ?").get(id),
		).toEqual({ title: "original", version: 1 });
		expect(context.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
		expect(context.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(1);
		expect(context.sqlite.prepare("SELECT * FROM memory_vectors").all()).toEqual([]);
	};
	return { ...context, request, id, unchanged };
}

const operations = [
	["PATCH", "", { title: "original" }],
	["POST", "/rollback", { to_version: 1 }],
	["PUT", "/vector", { profile: "tiny-3", values: [1, 0, 0] }],
] as const;
const conflict = { code: "version_conflict", details: { current_version: 1 } };

describe("zero expected version OCC", () => {
	it.each(["/api/v1", "/api/admin"])(
		"returns conflicts through %s without writes",
		async (prefix) => {
			const { request, id, unchanged } = await fixture(prefix);
			for (const [method, suffix, fields] of operations) {
				for (const [version, headers] of [
					[{ expected_version: 0 }, {}],
					[{}, { "If-Match": "0" }],
					[{}, { "If-Match": '"0"' }],
					[{ expected_version: 0 }, { "If-Match": '"0"' }],
				] as const) {
					const response = await request(
						`/memories/${id}${suffix}`,
						method,
						{ ...fields, ...version },
						headers,
					);
					expect(
						response.status,
						`${method} ${suffix} ${JSON.stringify(version)} ${JSON.stringify(headers)}`,
					).toBe(409);
					expect(await response.json()).toMatchObject({ error: conflict });
				}
			}
			const response = await request("/memories:batchUpdate", "POST", {
				items: [
					{ id, title: "original", expected_version: 0 },
					{ id, patch: { title: "original", expected_version: 0 } },
				],
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				results: [
					{ ok: false, error: conflict },
					{ ok: false, error: conflict },
				],
			});
			unchanged();
		},
	);

	it("returns the same MCP conflicts for flat and nested no-op updates", async () => {
		const { call, id, unchanged } = await fixture();
		for (const args of [
			{ id, title: "original", expected_version: 0 },
			{ id, patch: { title: "original", expected_version: 0 } },
		]) {
			expect((await call("update_memory", args)).result).toMatchObject({
				isError: true,
				structuredContent: { error: conflict },
			});
		}
		unchanged();
	});

	it("keeps zero conflicts per-item while a valid batch update advances the current version", async () => {
		const { request, id } = await fixture();
		const response = await request("/memories:batchUpdate", "POST", {
			items: [
				{ id, title: "rejected", expected_version: 0 },
				{ id, title: "accepted", expected_version: 1 },
				{ id, patch: { title: "rejected", expected_version: 0 } },
			],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: false, error: conflict },
				{ ok: true, item: { id, title: "accepted", version: 2 } },
				{ ok: false, error: { code: "version_conflict", details: { current_version: 2 } } },
			],
		});
	});

	it("preserves invalid syntax, negative versions and header/body mismatches", async () => {
		const { request, call, id, unchanged } = await fixture();
		for (const [method, suffix, fields] of operations) {
			for (const expected_version of [-1, 1.5, "0", null]) {
				const response = await request(`/memories/${id}${suffix}`, method, {
					...fields,
					expected_version,
				});
				expect(response.status).toBe(400);
				expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
			}
			for (const header of ["-1", '"-1"', 'W/"0"', "0,1", "invalid", "9007199254740992", "1"]) {
				expect(
					(
						await request(
							`/memories/${id}${suffix}`,
							method,
							{ ...fields, expected_version: 0 },
							{ "If-Match": header },
						)
					).status,
				).toBe(400);
			}
		}
		expect(
			(await request(`/memories/${id}/rollback`, "POST", { to_version: 0, expected_version: 0 }))
				.status,
		).toBe(400);
		for (const expected_version of [-1, 1.5, "0", null]) {
			for (const item of [
				{ id, title: "new", expected_version },
				{ id, patch: { title: "new", expected_version } },
			]) {
				expect((await request("/memories:batchUpdate", "POST", { items: [item] })).status).toBe(
					400,
				);
				expect((await call("update_memory", item)).result).toMatchObject({
					isError: true,
					structuredContent: { error: { code: "validation_failed" } },
				});
			}
		}
		unchanged();
	});

	it.each(["readonly", "hidden", "own-only", "missing", "trashed"])(
		"preserves %s authorization before zero OCC without leaking versions",
		async (denial) => {
			const { request, call, sqlite, key, id: createdId } = await fixture();
			if (denial === "readonly")
				sqlite.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").run(key.row.id);
			if (denial === "hidden")
				sqlite
					.prepare("UPDATE api_keys SET scope = 'spaces', space_ids_json = '[]' WHERE id = ?")
					.run(key.row.id);
			if (denial === "own-only") {
				sqlite.prepare("UPDATE api_keys SET own_entries_only = 1 WHERE id = ?").run(key.row.id);
				sqlite.exec("UPDATE memories SET source_key_id = 'other-key'");
			}
			if (denial === "trashed") sqlite.exec("UPDATE memories SET deleted_at = 1");
			const id = denial === "missing" ? "missing" : createdId;
			const status = ["readonly", "own-only"].includes(denial) ? 403 : 404;
			const error = { code: status === 403 ? "forbidden" : "not_found" };
			for (const [method, suffix, fields] of operations) {
				const response = await request(`/memories/${id}${suffix}`, method, {
					...fields,
					expected_version: 0,
				});
				expect(response.status).toBe(status);
				const body = await response.json();
				expect(body).toMatchObject({ error });
				expect(JSON.stringify(body)).not.toContain("current_version");
			}
			const batch = await request("/memories:batchUpdate", "POST", {
				items: [{ id, title: "new", expected_version: 0 }],
			});
			expect(batch.status).toBe(200);
			const batchBody = await batch.json();
			expect(batchBody).toMatchObject({ results: [{ ok: false, error }] });
			expect(JSON.stringify(batchBody)).not.toContain("current_version");
			const mcp = (await call("update_memory", { id, title: "new", expected_version: 0 })).result;
			expect(mcp).toMatchObject({ isError: true, structuredContent: { error } });
			expect(JSON.stringify(mcp)).not.toContain("current_version");
		},
	);
});
