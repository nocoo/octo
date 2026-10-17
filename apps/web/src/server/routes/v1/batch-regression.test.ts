import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppVars, Env } from "../../env";
import { StubMemoryService } from "../../services/stub-memories";
import { testApiPrincipal } from "../../test-principal";
import { createBatchRoutes } from "./batch";

const input = { space: "kb", title: "t", body: "b", type: "note" as const, tags: [] };
const ctx = { keyId: "kid", actor: "key:kid" };

function appWith(svc: StubMemoryService, own = false) {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		c.set("apiKey", {
			...testApiPrincipal(),
			scope: "spaces",
			spaceIds: ["space:kb", "space:dest"],
			ownEntriesOnly: own,
		});
		await next();
	});
	app.route("/api/v1", createBatchRoutes(svc));
	return app;
}
async function post(app: ReturnType<typeof appWith>, action: string, body: unknown) {
	const res = await app.request(
		`/api/v1/memories:batch${action}`,
		{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
		{} as Env,
	);
	expect(res.status).toBe(200);
	return res.json() as Promise<{
		results: Array<{ ok: boolean; error?: { code: string }; item?: { id: string } }>;
	}>;
}

describe("batch authorization regression", () => {
	it("resolves slugs to ids and permits only the creator's updates, moves and deletes", async () => {
		const svc = new StubMemoryService();
		const app = appWith(svc, true);
		const created = await post(app, "Create", { items: [input] });
		expect(created.results[0]?.ok).toBe(true);
		const own = await svc.create(input, ctx);
		const other = await svc.create(input, { keyId: "other", actor: "key:other" });
		const updated = await post(app, "Update", {
			items: [own, other].map((r) => ({ id: r.id, space: "dest", expected_version: 1 })),
		});
		expect(updated.results.map((r) => r.ok)).toEqual([true, false]);
		expect(updated.results[1]?.error?.code).toBe("forbidden");
		const deleted = await post(app, "Delete", { ids: [own.id, other.id] });
		expect(deleted.results.map((r) => r.ok)).toEqual([true, false]);
		expect(deleted.results[1]?.error?.code).toBe("forbidden");
	});
	it.each(["Update", "Delete"])("continues %s after an item lookup throws", async (action) => {
		const svc = new StubMemoryService();
		const rows = await Promise.all([1, 2, 3].map(() => svc.create(input, ctx)));
		const get = svc.get.bind(svc);
		vi.spyOn(svc, "get").mockImplementation((id, c) => {
			if (id === rows[1]?.id) throw new Error("lookup failed");
			return get(id, c);
		});
		const result = await post(
			appWith(svc),
			action,
			action === "Delete"
				? { ids: rows.map((r) => r.id) }
				: { items: rows.map((r) => ({ id: r.id, title: "updated", expected_version: 1 })) },
		);
		expect(result.results.map((r) => r.ok)).toEqual([true, false, true]);
		expect(result.results[1]?.error?.code).toBe("internal");
	});
});
