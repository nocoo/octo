import { describe, expect, it } from "vitest";
import { base, e2eD1, query, seedKey, sqlText } from "../fixtures/l2-batch";

async function fixture() {
	const d1 = await e2eD1();
	const mover = await seedKey(d1);
	const source = `move-source-${mover.id.toLowerCase()}`;
	const target = `move-target-${mover.id.toLowerCase()}`;
	await d1([
		"--command",
		`INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES ('${source}','${source}','Source',1,1), ('${target}','${target}','Target',1,1); UPDATE api_keys SET role = 'custom' WHERE id = '${mover.id}';`,
	]);
	const old = await seedKey(d1, { ops: "r", scope: "spaces", spaceIds: [source] });
	const destination = await seedKey(d1, { ops: "r", scope: "spaces", spaceIds: [target] });
	async function request(
		path: string,
		method = "GET",
		body?: unknown,
		token: string | null = mover.token,
		extra = {},
	) {
		return fetch(`${base}/api/v1${path}`, {
			method,
			headers: {
				"content-type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...extra,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}
	async function create(vector?: { profile: string; values: number[] }) {
		const response = await request("/memories", "POST", {
			space: source,
			title: "retained memory me",
			body: "move preservation",
			type: "note",
			tags: ["move-second", "move-first"],
			...(vector ? { vector } : {}),
		});
		expect(response.status).toBe(201);
		return (await response.json()) as { id: string; version: number };
	}
	return { d1, mover, old, destination, source, target, request, create };
}

describe("space moves over workerd HTTP", () => {
	it("preserves R2 references and vectors and immediately isolates all old-space reads", async () => {
		const { d1, mover, old, destination, source, target, request, create } = await fixture();
		const [profile] = await query<{ id: string; dims: number }>(
			d1,
			"SELECT id,dims FROM embedding_profiles WHERE active = 1",
		);
		if (!profile) throw new Error("active local profile missing");
		const vector = {
			profile: profile.id,
			values: Array.from({ length: profile.dims }, (_, index) => (index === 0 ? 1 : 0)),
		};
		const { id } = await create(vector);
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const uploaded = await fetch(`${base}/api/v1/memories/${id}/attachments`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${mover.token}`,
				"Content-Type": "image/png",
				"X-Filename": "move.png",
			},
			body: png,
		});
		expect(uploaded.status).toBe(201);
		const attachment = (await uploaded.json()) as { id: string };
		const stored = await query(
			d1,
			`SELECT hex(vector) AS vector,content_hash FROM memory_vectors WHERE memory_id = ${sqlText(id)}`,
		);
		const refs = await query(d1, `SELECT r2_key FROM attachments WHERE memory_id = ${sqlText(id)}`);
		const head = (await (await request("/changes/head")).json()) as { cursor: string };
		const moved = await request(`/memories/${id}/move`, "POST", { space: target }, mover.token, {
			"If-Match": '"1"',
			"Idempotency-Key": "single-move",
		});
		expect(moved.status).toBe(200);
		expect(await moved.json()).toMatchObject({
			id,
			space: target,
			version: 2,
			tags: ["move-second", "move-first"],
		});
		expect(
			await query(
				d1,
				`SELECT hex(vector) AS vector,content_hash FROM memory_vectors WHERE memory_id = ${sqlText(id)}`,
			),
		).toEqual(stored);
		expect(
			await query(d1, `SELECT r2_key FROM attachments WHERE memory_id = ${sqlText(id)}`),
		).toEqual(refs);
		expect((await request(`/memories/${id}`, "GET", undefined, old.token)).status).toBe(404);
		expect(
			(await request(`/attachments/${attachment.id}/url`, "GET", undefined, old.token)).status,
		).toBe(404);
		const signed = (await (
			await request(`/attachments/${attachment.id}/url`, "GET", undefined, destination.token)
		).json()) as { url: string };
		expect(new Uint8Array(await (await fetch(signed.url)).arrayBuffer())).toEqual(png);
		const list = (await (await request("/memories", "GET", undefined, old.token)).json()) as {
			items: { id: string }[];
		};
		expect(list.items.map((item) => item.id)).not.toContain(id);
		for (const input of [
			{ query: "retained", mode: "fts" },
			{ query: "me", mode: "fts" },
			{ vector, mode: "vector" },
		]) {
			for (const reader of [old, destination]) {
				const response = await request("/search", "POST", input, reader.token);
				expect(response.status).toBe(200);
				const body = (await response.json()) as { items: { id: string }[] };
				expect(
					body.items.some((item) => item.id === id),
					`${input.mode} ${"query" in input ? input.query : "vector"}`,
				).toBe(reader === destination);
			}
		}
		const oldChanges = (await (
			await request(`/changes?cursor=${head.cursor}`, "GET", undefined, old.token)
		).json()) as { items: Record<string, unknown>[] };
		expect(oldChanges.items).toEqual([expect.objectContaining({ entity_id: id, op: "moved_out" })]);
		expect(oldChanges.items[0]).not.toHaveProperty("space_id");
		const newChanges = (await (
			await request(`/changes?cursor=${head.cursor}`, "GET", undefined, destination.token)
		).json()) as { items: Record<string, unknown>[] };
		expect(newChanges.items).toEqual([
			expect.objectContaining({ entity_id: id, op: "moved", space_id: target, version: 2 }),
		]);
		expect(
			await query(
				d1,
				`SELECT space_id,COUNT(*) AS count FROM memories WHERE id = ${sqlText(id)} GROUP BY space_id`,
			),
		).toEqual([{ space_id: target, count: 1 }]);
		const replay = await request(`/memories/${id}/move`, "POST", { space: target }, mover.token, {
			"If-Match": '"1"',
			"Idempotency-Key": "single-move",
		});
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(
			(
				await request(`/memories/${id}/move`, "POST", { space: source }, mover.token, {
					"If-Match": "0",
				})
			).status,
		).toBe(409);
		expect((await request(`/memories/${id}/move`, "POST", { space: source }, null)).status).toBe(
			401,
		);
		expect(
			(await request(`/memories/${id}/move`, "POST", { space: target }, destination.token)).status,
		).toBe(403);
		expect(
			(await request(`/memories/${id}/move`, "POST", { space: target, unknown: true })).status,
		).toBe(400);
		await request(`/memories/${id}`, "DELETE");
		expect((await request(`/memories/${id}/move`, "POST", { space: source })).status).toBe(404);
	});

	it("accepts bilateral update-only keys and returns ordered independent batch outcomes", async () => {
		const { d1, source, target, request, create } = await fixture();
		const first = await create();
		const second = await create();
		const updater = await seedKey(d1, { ops: "u", scope: "spaces", spaceIds: [source, target] });
		await d1(["--command", `UPDATE api_keys SET role = 'custom' WHERE id = '${updater.id}'`]);
		const body = {
			space: target,
			items: [
				{ id: first.id },
				{ id: "missing" },
				{ id: second.id, expected_version: 0 },
				{ id: second.id, expected_version: 1 },
				{ id: first.id },
			],
		};
		const result = await request("/memories:batchMove", "POST", body, updater.token, {
			"Idempotency-Key": "batch-move",
		});
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({
			results: [
				{ id: first.id, ok: true },
				{ id: "missing", ok: false, error: expect.objectContaining({ code: "not_found" }) },
				{ id: second.id, ok: false, error: expect.objectContaining({ code: "version_conflict" }) },
				{ id: second.id, ok: true },
				{ id: first.id, ok: true },
			],
		});
		expect(
			(
				await request("/memories:batchMove", "POST", body, updater.token, {
					"Idempotency-Key": "batch-move",
				})
			).headers.get("Idempotent-Replayed"),
		).toBe("true");
		await d1([
			"--command",
			`UPDATE api_keys SET space_ids_json = '["${source}"]' WHERE id = '${updater.id}'`,
		]);
		expect(
			(
				await request("/memories:batchMove", "POST", body, updater.token, {
					"Idempotency-Key": "batch-move",
				})
			).status,
		).toBe(404);
		expect((await request("/memories:batchMove", "POST", body, null)).status).toBe(401);
		expect(
			(await request("/memories:batchMove", "POST", { space: target, items: [] })).status,
		).toBe(400);
		expect(
			(
				await request("/memories:batchMove", "POST", {
					space: target,
					items: Array.from({ length: 101 }, () => ({ id: first.id })),
				})
			).status,
		).toBe(413);
		const atLimit = await request("/memories:batchMove", "POST", {
			space: target,
			items: Array.from({ length: 100 }, () => ({ id: first.id })),
		});
		expect(atLimit.status).toBe(200);
		expect(await atLimit.json()).toEqual({
			results: Array.from({ length: 100 }, () => ({ id: first.id, ok: true })),
		});
	});
});
