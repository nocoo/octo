import { describe, expect, it } from "vitest";
import { base, e2eD1, query, seedKey, sqlText } from "../fixtures/l2-batch";

const json = { "content-type": "application/json" };

describe("tag mutation idempotency", () => {
	it.each(["rename", "merge"])("atomically persists and replays %s effects", async (op) => {
		const db = await e2eD1();
		const admin = await seedKey(db);
		const readonly = await seedKey(db, { ops: "r" });
		const scoped = await seedKey(db, { ops: "u", scope: "spaces" });
		const suffix = crypto.randomUUID();
		const source = `tag-${suffix}`;
		const target = `into-${suffix}`;
		const renamed = `renamed-${suffix}`;
		const space = `space-${suffix}`;
		const memory = `memory-${suffix}`;
		await db([
			"--command",
			`
			INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('${space}', '${space}', 'test', 1, 1);
			INSERT INTO tags (id, name, display_name, created_at, updated_at) VALUES ('${source}', '${source}', '${source}', 1, 1), ('${target}', '${target}', '${target}', 1, 1);
			INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('${memory}', '${space}', 'title', 'body', 'note', 0.5, '${admin.id}', 1, 'hash', 1, 1);
			INSERT INTO memory_tags (memory_id, tag_id) VALUES ('${memory}', '${source}'), ('${memory}', '${target}');
		`,
		]);
		const body = op === "rename" ? { new_name: renamed } : { into: target };
		const post = (raw: unknown = body, token: string | null = admin.token, key = "tag-outcome") =>
			fetch(`${base}/api/v1/tags/${source}/${op}`, {
				method: "POST",
				headers: {
					...json,
					"Idempotency-Key": key,
					...(token === null ? {} : { Authorization: `Bearer ${token}` }),
				},
				body: typeof raw === "string" ? raw : JSON.stringify(raw),
			});
		for (const [token, status, code] of [
			[null, 401, "unauthenticated"],
			["invalid", 401, "unauthenticated"],
			[readonly.token, 403, "forbidden"],
			[scoped.token, 403, "forbidden"],
		] as const) {
			const res = await post(body, token, "denied");
			expect(res.status).toBe(status);
			expect(await res.json()).toMatchObject({ error: { code, request_id: expect.any(String) } });
		}
		for (const invalid of ["{", { ...body, extra: true }]) {
			const res = await post(invalid, admin.token, crypto.randomUUID());
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } });
		}
		const observe = () =>
			query<{
				name: string;
				merged_into: string | null;
				links: string;
				changes: number;
				version: number;
				outcomes: number;
			}>(
				db,
				`SELECT t.name, t.merged_into, (SELECT GROUP_CONCAT(tag_id, ',') FROM (SELECT tag_id FROM memory_tags WHERE memory_id = '${memory}' ORDER BY tag_id)) AS links, (SELECT COUNT(*) FROM changes WHERE actor = 'key:${admin.id}') AS changes, m.version, (SELECT COUNT(*) FROM idempotency_records WHERE key_id = '${admin.id}' AND idem_key = 'tag-outcome') AS outcomes FROM tags t JOIN memories m ON m.id = '${memory}' WHERE t.id = '${source}'`,
			);
		const before = await observe();
		expect(before).toEqual([
			{
				name: source,
				merged_into: null,
				links: [source, target].sort().join(","),
				changes: 0,
				version: 1,
				outcomes: 0,
			},
		]);
		const trigger = `fail_tag_${suffix.replaceAll("-", "")}`;
		await db([
			"--command",
			`CREATE TRIGGER ${trigger} BEFORE INSERT ON idempotency_response_chunks WHEN NEW.key_id = ${sqlText(admin.id)} AND NEW.idem_key = 'tag-outcome' BEGIN SELECT RAISE(ABORT, 'tag response storage failed'); END`,
		]);
		try {
			const failed = await post();
			expect(failed.status).toBe(503);
			expect(await failed.json()).toMatchObject({ error: { code: "unavailable" } });
			expect(await observe()).toEqual(before);
		} finally {
			await db(["--command", `DROP TRIGGER ${trigger}`]);
		}
		const responses = await Promise.all(Array.from({ length: 8 }, () => post()));
		expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
		expect(responses.filter((r) => r.headers.get("Idempotent-Replayed") === "true")).toHaveLength(
			7,
		);
		const bodies = await Promise.all(responses.map((r) => r.text()));
		expect(new Set(bodies).size).toBe(1);
		if (op === "rename")
			expect(JSON.parse(bodies[0] ?? "")).toMatchObject({ id: source, name: renamed });
		else
			expect(JSON.parse(bodies[0] ?? "")).toMatchObject({
				from: { id: source },
				into: { id: target },
				memories: 1,
			});
		const replay = await post();
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(bodies[0]);
		const mismatch = await post({ ...body, extra: true });
		expect(mismatch.status).toBe(409);
		expect(await mismatch.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
		expect(await observe()).toEqual([
			{
				name: op === "rename" ? renamed : source,
				merged_into: op === "rename" ? null : target,
				links: op === "rename" ? [source, target].sort().join(",") : target,
				changes: 1,
				version: 1,
				outcomes: 1,
			},
		]);
		for (const name of op === "rename" ? [renamed, target] : [target]) {
			const fts = await query<{ memory_id: string }>(
				db,
				`SELECT map.memory_id FROM memories_fts f JOIN memories_fts_map map ON map.fts_rowid = f.rowid WHERE map.memory_id = '${memory}' AND memories_fts MATCH ${sqlText(`"${name}"`)}`,
			);
			expect(fts).toEqual([{ memory_id: memory }]);
		}
		expect(
			await query(
				db,
				`SELECT map.memory_id FROM memories_fts f JOIN memories_fts_map map ON map.fts_rowid = f.rowid WHERE map.memory_id = '${memory}' AND memories_fts MATCH ${sqlText(`"${source}"`)}`,
			),
		).toEqual([]);
	});
});
