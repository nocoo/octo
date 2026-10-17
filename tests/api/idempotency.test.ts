import { describe, expect, it } from "vitest";
import {
	type BatchBody,
	createMemory,
	e2eD1,
	effectCount,
	input,
	post,
	query,
	seedKey,
	sqlText,
	stored,
} from "../fixtures/l2-batch";

describe("idempotency over real HTTP with M1 auth", () => {
	it("replays a sequential batch without executing more effects", async () => {
		const d1 = e2eD1();
		const key = await seedKey(d1);
		const first = await post("Create", key.token, { items: [input] }, "sequential");
		expect(first.status).toBe(200);
		const body = await first.text();
		expect((JSON.parse(body) as BatchBody).results[0]?.ok).toBe(true);
		const replay = await post("Create", key.token, { items: [input] }, "sequential");
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(body);
		expect(effectCount(d1, key.id)).toBe(1);
	});
	it("commits exactly one side effect for eight simultaneous identical requests", async () => {
		const d1 = e2eD1();
		const key = await seedKey(d1);
		const responses = await Promise.all(
			Array.from({ length: 8 }, () => post("Create", key.token, { items: [input] }, "concurrent")),
		);
		expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
		expect(responses.filter((r) => r.headers.get("Idempotent-Replayed") === "true")).toHaveLength(
			7,
		);
		const bodies = await Promise.all(responses.map((r) => r.text()));
		expect(new Set(bodies).size).toBe(1);
		expect((JSON.parse(bodies[0] ?? "null") as BatchBody).results[0]?.ok).toBe(true);
		expect(effectCount(d1, key.id)).toBe(1);
	});
	it("makes concurrent different hashes conflict without executing the loser's plan", async () => {
		const d1 = e2eD1();
		const key = await seedKey(d1);
		const responses = await Promise.all(
			["one", "two"].map((title) =>
				post("Create", key.token, { items: [{ ...input, title }] }, "hash-race"),
			),
		);
		expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
		const conflict = responses.find((r) => r.status === 409);
		expect(await conflict?.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
		const winnerText = await responses.find((r) => r.status === 200)?.text();
		expect(winnerText).toBeDefined();
		const winner = (JSON.parse(winnerText ?? "{}") as BatchBody).results[0]?.item;
		expect(winner?.title).toMatch(/^(one|two)$/u);
		const replay = await post(
			"Create",
			key.token,
			{ items: [{ ...input, title: winner?.title }] },
			"hash-race",
		);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(winnerText);
		expect(effectCount(d1, key.id)).toBe(1);
	});
	it("isolates the same idempotency key across real API keys", async () => {
		const d1 = e2eD1();
		const keys = await Promise.all([seedKey(d1), seedKey(d1)]);
		const responses = await Promise.all(
			keys.map((key) => post("Create", key.token, { items: [input] }, "shared-key")),
		);
		expect(responses.map((r) => r.status)).toEqual([200, 200]);
		expect(responses.every((r) => r.headers.get("Idempotent-Replayed") === null)).toBe(true);
		const bodies = await Promise.all(responses.map((r) => r.json() as Promise<BatchBody>));
		expect(bodies[0]?.results[0]?.item?.id).not.toBe(bodies[1]?.results[0]?.item?.id);
		for (const key of keys) expect(effectCount(d1, key.id)).toBe(1);
	});
	it.each(["__proto__", "constructor", "prototype"])(
		"preserves %s in hash conflicts",
		async (field) => {
			const d1 = e2eD1();
			const key = await seedKey(d1);
			const body = JSON.stringify({ items: [input] });
			expect((await post("Create", key.token, body, "all-fields")).status).toBe(200);
			const changed = `${body.slice(0, -1)},"${field}":{"x":1}}`;
			const res = await post("Create", key.token, changed, "all-fields");
			expect(res.status).toBe(409);
			expect(await res.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
			expect(effectCount(d1, key.id)).toBe(1);
		},
	);
	it.each(["", "bad\tkey", "x".repeat(129)])(
		"rejects invalid header %j before effects",
		async (header) => {
			const d1 = e2eD1();
			const key = await seedKey(d1);
			const res = await post("Create", key.token, { items: [input] }, header);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } });
			expect(effectCount(d1, key.id)).toBe(0);
		},
	);
	it("treats method/path and the entire batch as one idempotency unit", async () => {
		const d1 = e2eD1();
		const key = await seedKey(d1);
		const item = await createMemory(key.token);
		const update = { items: [{ id: item.id, title: "new", expected_version: 1 }] };
		const first = await post("Update", key.token, update, "whole-batch");
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({ results: [{ ok: true, item: { version: 2 } }] });
		const replay = await post("Update", key.token, update, "whole-batch");
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.json()).toMatchObject({ results: [{ ok: true, item: { version: 2 } }] });
		const changedPath = await post("Delete", key.token, { ids: [item.id] }, "whole-batch");
		expect(changedPath.status).toBe(409);
		expect(stored(d1, item.id)?.deleted_at).toBeNull();
		expect(JSON.parse(stored(d1, item.id)?.record_json ?? "null")).toMatchObject({ version: 2 });
		const deleted = await post("Delete", key.token, { ids: [item.id] }, "delete");
		expect(deleted.status).toBe(200);
		const original = await deleted.text();
		expect((JSON.parse(original) as BatchBody).results[0]?.ok).toBe(true);
		const deleteReplay = await post("Delete", key.token, { ids: [item.id] }, "delete");
		expect(deleteReplay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await deleteReplay.text()).toBe(original);
	});
	it("persists legitimate large batches across rows and replays their complete response", async () => {
		const d1 = e2eD1();
		const key = await seedKey(d1);
		const body = {
			items: Array.from({ length: 3 }, () => ({ ...input, body: "x".repeat(800_000) })),
		};
		const first = await post("Create", key.token, body, "large-batch");
		expect(first.status).toBe(200);
		const original = await first.text();
		expect((JSON.parse(original) as BatchBody).results.every((r) => r.ok)).toBe(true);
		const chunks = query<{ n: number; max_bytes: number }>(
			d1,
			`SELECT count(*) AS n, max(length(CAST(body AS BLOB))) AS max_bytes FROM idempotency_response_chunks WHERE key_id = ${sqlText(key.id)}`,
		)[0];
		expect(chunks?.n).toBeGreaterThan(3);
		expect(chunks?.max_bytes).toBeLessThanOrEqual(240_000);
		const replay = await post("Create", key.token, body, "large-batch");
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(original);
		expect(effectCount(d1, key.id)).toBe(3);
	});
	it("rolls back business effects on response storage failure and safely retries", async () => {
		const d1 = e2eD1();
		const key = await seedKey(d1);
		const trigger = `fail_${key.id}`;
		d1([
			"--command",
			`CREATE TRIGGER ${trigger} BEFORE INSERT ON idempotency_response_chunks WHEN NEW.key_id = ${sqlText(key.id)} BEGIN SELECT RAISE(ABORT, 'injected chunk failure'); END`,
		]);
		try {
			const failed = await post("Create", key.token, { items: [input] }, "recover");
			expect(failed.status).toBe(503);
			expect(await failed.json()).toMatchObject({ error: { code: "unavailable" } });
			expect(effectCount(d1, key.id)).toBe(0);
			expect(
				query(d1, `SELECT * FROM idempotency_records WHERE key_id = ${sqlText(key.id)}`),
			).toEqual([]);
		} finally {
			d1(["--command", `DROP TRIGGER ${trigger}`]);
		}
		expect((await post("Create", key.token, { items: [input] }, "recover")).status).toBe(200);
		const replay = await post("Create", key.token, { items: [input] }, "recover");
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(effectCount(d1, key.id)).toBe(1);
	});
});
