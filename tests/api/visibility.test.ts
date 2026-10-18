import { describe, expect, it } from "vitest";
import {
	base,
	createMemory,
	e2eD1,
	post,
	seedKey,
	seedSpace,
	sqlText,
	stored,
} from "../fixtures/l2-batch";

describe.each(["spaces", "own"] as const)("knowledge-base visibility with %s scope", (scope) => {
	it("hides single vector writes and filters mixed collections without changing hidden data", async () => {
		const d1 = await e2eD1();
		const admin = await seedKey(d1);
		const scoped = await seedKey(d1, { scope });
		const visibleSpace = await seedSpace(d1, scoped.id);
		const hiddenSpace = await seedSpace(d1);
		if (scope === "spaces") {
			await d1([
				"--command",
				`UPDATE api_keys SET space_ids_json = ${sqlText(JSON.stringify([visibleSpace.id]))} WHERE id = ${sqlText(scoped.id)}`,
			]);
		}
		const visible = await createMemory(admin.token, {
			space: visibleSpace.slug,
			tags: ["visible-only"],
		});
		const hidden = await createMemory(admin.token, {
			space: hiddenSpace.slug,
			tags: ["hidden-only"],
		});
		const before = await stored(d1, hidden.id);
		const headers = { Authorization: `Bearer ${scoped.token}`, "Content-Type": "application/json" };
		const vector = await fetch(`${base}/api/v1/memories/${hidden.id}/vector`, {
			method: "PUT",
			headers,
			body: JSON.stringify({
				profile: "te3-small-1536",
				values: Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
				expected_version: 1,
			}),
		});
		expect(vector.status).toBe(404);
		expect(await vector.json()).toMatchObject({ error: { code: "not_found" } });
		const batch = await fetch(`${base}/api/v1/memories:batchGet`, {
			method: "POST",
			headers,
			body: JSON.stringify({ ids: [visible.id, hidden.id, "missing"] }),
		});
		expect(batch.status).toBe(200);
		expect(await batch.json()).toMatchObject({
			items: [expect.objectContaining({ id: visible.id })],
			missing: [hidden.id, "missing"],
		});
		for (const collection of ["memories", "changes"]) {
			const response = await fetch(`${base}/api/v1/${collection}?spaces=${hiddenSpace.slug}`, {
				headers,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ items: [], next_cursor: null });
		}
		const head = await fetch(`${base}/api/v1/changes/head?spaces=${hiddenSpace.slug}`, { headers });
		expect(head.status).toBe(200);
		const cursor = (await head.json()) as { cursor: string };
		expect(JSON.parse(Buffer.from(cursor.cursor, "base64url").toString())).toEqual({ s: 0 });
		const created = await post("Create", scoped.token, {
			items: [{ space: hiddenSpace.slug, title: "Hidden", body: "", type: "note", tags: [] }],
		});
		expect(created.status).toBe(200);
		expect(await created.json()).toMatchObject({
			results: [{ ok: false, error: { code: "not_found" } }],
		});
		expect(await stored(d1, hidden.id)).toEqual(before);
	});
});
