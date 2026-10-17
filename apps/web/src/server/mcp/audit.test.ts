import { describe, expect, it } from "vitest";
import { rollupUsage } from "../audit/usage";
import { memoryInput, setup } from "./__tests__/app";

describe("MCP audit and usage semantics", () => {
	it("counts business errors and only committed tool writes", async () => {
		const { call, rpc, sqlite, db, key, flush } = await setup();
		await rpc("tools/list");
		await call("get_memory", { id: "missing" });
		await flush();
		await rollupUsage(db);
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 2, errors: 1, writes: 0 });
		const created = (await call("create_memory", memoryInput)).result.structuredContent;
		await call("get_memory", { id: created.id });
		await call("update_memory", {
			id: created.id,
			patch: { title: "updated", expected_version: 1 },
		});
		await call("update_memory", { id: created.id, patch: { title: "stale", expected_version: 1 } });
		await call("delete_memory", { id: created.id });
		await flush();
		await rollupUsage(db);
		expect(
			sqlite
				.prepare("SELECT calls, errors, writes FROM usage_daily WHERE key_id = ?")
				.get(key.row.id),
		).toEqual({ calls: 7, errors: 2, writes: 3 });
		expect(
			sqlite
				.prepare(
					"SELECT count(*) AS writes FROM mcp_audit_writes JOIN audit_log ON audit_id = id WHERE actor = ?",
				)
				.get(`key:${key.row.id}`),
		).toEqual({ writes: 3 });
	});

	it.each(["PUT", "PATCH", "OPTIONS"])(
		"keeps method rejection %s discoverable in MCP audit",
		async (method) => {
			const { app, headers, env, ctx, sqlite, flush } = await setup();
			const response = await app.request("http://local/mcp", { method, headers }, env, ctx);
			expect(response.status).toBe(405);
			await flush();
			expect(sqlite.prepare("SELECT route, status, error_code FROM audit_log").get()).toEqual({
				route: "/mcp",
				status: 405,
				error_code: "validation_failed",
			});
		},
	);
});
