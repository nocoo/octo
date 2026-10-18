import { expect, it } from "vitest";
import { base, e2eD1, seedKey } from "../fixtures/l2-batch";

it("round-trips caller tag order and versions a pure reorder over HTTP", async () => {
	const d1 = await e2eD1();
	const key = await seedKey(d1);
	await d1([
		"--command",
		"INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES ('order-kbr1','order-kbr1','Order',1,1)",
	]);
	const headers = { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" };
	const created = await fetch(`${base}/api/v1/memories`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			space: "order-kbr1",
			title: "Order",
			body: "Tag order",
			type: "note",
			tags: ["Zulu", "alpha", "zulu", "中文"],
		}),
	});
	expect(created.status).toBe(201);
	const memory = (await created.json()) as { id: string; tags: string[] };
	const tags = ["zulu", "alpha", "中文"];
	expect(memory.tags).toEqual(tags);
	const path = `${base}/api/v1/memories/${memory.id}`;
	expect(await (await fetch(path, { headers })).json()).toMatchObject({ tags });
	expect(
		await (await fetch(`${base}/api/v1/memories?spaces=order-kbr1`, { headers })).json(),
	).toMatchObject({ items: [expect.objectContaining({ tags })] });
	const batch = await fetch(`${base}/api/v1/memories:batchGet`, {
		method: "POST",
		headers,
		body: JSON.stringify({ ids: [memory.id] }),
	});
	expect(await batch.json()).toMatchObject({ items: [expect.objectContaining({ tags })] });
	const reordered = ["中文", "alpha", "zulu"];
	const updated = await fetch(path, {
		method: "PATCH",
		headers: { ...headers, "If-Match": "1" },
		body: JSON.stringify({ tags: reordered }),
	});
	expect(updated.status).toBe(200);
	expect(await updated.json()).toMatchObject({ tags: reordered, version: 2 });
	expect(await (await fetch(`${path}/diff?from=1&to=2`, { headers })).json()).toMatchObject({
		fields: [{ field: "tags", from: tags, to: reordered }],
	});
	const rollback = await fetch(`${path}/rollback`, {
		method: "POST",
		headers: { ...headers, "If-Match": "2" },
		body: JSON.stringify({ to_version: 1 }),
	});
	expect(rollback.status).toBe(200);
	expect(await rollback.json()).toMatchObject({ tags, version: 3 });
});
