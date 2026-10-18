import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ORIGIN_PROD } from "../../apps/web/src/server/auth/origin";
import { indexText } from "../../apps/web/src/server/search/tokenizer";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, sqlText } from "../fixtures/l2-batch";
import { SEARCH_QUESTIONS } from "../fixtures/search-questions";

const space = "word-recall-r3";
const ids = new Map<string, string>();
const vector = { profile: "te3-small-1536", values: [1, ...Array<number>(1535).fill(0)] };
let key: { id: string; token: string };

beforeAll(async () => {
	const d1 = await e2eD1();
	await assertAsyncTestMarker(d1);
	await d1([
		"--command",
		`INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES ('${space}','${space}','Word recall',1,1)`,
	]);
	key = await seedKey(d1, { scope: "spaces", spaceIds: [space] });
	for (const fixture of SEARCH_QUESTIONS) {
		const response = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				space,
				title: fixture.id,
				body: fixture.body,
				type: "note",
				tags: [],
				vector,
			}),
		});
		expect(response.status).toBe(201);
		ids.set(fixture.id, ((await response.json()) as { id: string }).id);
	}
	const noise = "猫喜欢玩耍，每天早上散步，服务器运行正常，周末开会，咖喱配啡色盘子";
	await d1([
		"--command",
		`
UPDATE memories SET created_at=1, updated_at=1 WHERE space_id='${space}';
WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value+1 FROM numbers WHERE value<510)
INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
SELECT 'word-noise-'||value,'${space}','Noise',${sqlText(noise)},'note',${sqlText(key.id)},'noise',100,100 FROM numbers;
INSERT INTO memories_fts_map(memory_id,fts_rowid) SELECT id,(SELECT COALESCE(MAX(fts_rowid),0) FROM memories_fts_map)+ROW_NUMBER() OVER (ORDER BY id) FROM memories WHERE space_id='${space}' AND id LIKE 'word-noise-%';
INSERT INTO memories_words_fts(rowid,title,body,tags) SELECT fts_rowid,'Noise',${sqlText(indexText(noise))},'' FROM memories_fts_map WHERE memory_id LIKE 'word-noise-%';
INSERT INTO memories_fts(rowid,title,body,tags) SELECT fts_rowid,'Noise',${sqlText(noise)},'' FROM memories_fts_map WHERE memory_id LIKE 'word-noise-%';`,
	]);
	expect(
		await query(
			d1,
			`SELECT count(*) AS count FROM memories WHERE space_id='${space}' AND updated_at>1`,
		),
	).toEqual([{ count: 510 }]);
});

afterAll(async () => {
	const d1 = await e2eD1();
	await assertAsyncTestMarker(d1);
	const selected = `SELECT id FROM memories WHERE space_id='${space}'`;
	await d1([
		"--command",
		`
DELETE FROM memories_words_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${selected}));
DELETE FROM memories_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${selected}));
${["memory_versions", "memory_tags", "memory_vectors", "memories_fts_map", "vector_sync_jobs"].map((table) => `DELETE FROM ${table} WHERE memory_id IN (${selected});`).join("\n")}
DELETE FROM memories WHERE space_id='${space}';
DELETE FROM spaces WHERE id='${space}';`,
	]);
});

describe.each(["fts", "hybrid"] as const)("old question recall on workerd in %s", (mode) => {
	it.each(
		SEARCH_QUESTIONS.flatMap((fixture) =>
			fixture.questions.map((question) => ({ question, id: fixture.id })),
		),
	)("ranks $question first", async ({ question, id }) => {
		const response = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ query: question, mode, vector, limit: 5 }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			items: Array<{ id: string }>;
			channels: { fts: { partial: boolean; partial_reason: null }; vector: { candidates: number } };
		};
		expect(body.items[0]?.id).toBe(ids.get(id));
		expect(body.channels.fts).toMatchObject({ partial: false, partial_reason: null });
		if (mode === "hybrid") expect(body.channels.vector.candidates).toBe(SEARCH_QUESTIONS.length);
	});
});

it("restricts bounded backfill to Access with origin checks and resumes idempotently", async () => {
	const path = `${base}/api/admin/settings/search/backfill`;
	const state = await loadJwksState();
	const jwt = await signAccessJwt(state, {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "word-backfill@local",
	});
	for (const headers of [{}, { Authorization: `Bearer ${key.token}` }]) {
		expect((await fetch(path, { method: "POST", headers })).status).toBe(401);
	}
	const headers = { "Cf-Access-Jwt-Assertion": jwt, Origin: ADMIN_ORIGIN_PROD };
	expect(
		(await fetch(path, { method: "POST", headers: { ...headers, Origin: "https://evil.example" } }))
			.status,
	).toBe(403);
	let complete = false;
	for (let attempt = 0; attempt < 30 && !complete; attempt++) {
		const response = await fetch(path, { method: "POST", headers });
		expect(response.status).toBe(200);
		const result = (await response.json()) as { tags: number; memories: number; complete: boolean };
		expect(result.tags + result.memories).toBeLessThanOrEqual(100);
		complete = result.complete;
	}
	expect(complete).toBe(true);
	expect(await (await fetch(path, { method: "POST", headers })).json()).toEqual({
		tags: 0,
		memories: 0,
		complete: true,
	});
});

it("preserves valid large Han and compatibility-letter bodies inside native D1 limits", async () => {
	let seed = 7;
	const han = Array.from({ length: 320_000 }, () => {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
		return String.fromCharCode(0x4e00 + (seed % 20_992));
	}).join("");
	for (const body of [han, "\ufdfa".repeat(320_000)]) {
		const response = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ space, title: "Large-row-canary", body, type: "note", tags: [] }),
		});
		expect(response.status).toBe(201);
		const saved = (await response.json()) as { id: string; body: string };
		expect(saved.body).toBe(body);
		const rows = await query<{ bytes: number }>(
			await e2eD1(),
			`SELECT length(CAST(words.body AS BLOB)) AS bytes FROM memories_words_fts words JOIN memories_fts_map map ON map.fts_rowid=words.rowid WHERE map.memory_id=${sqlText(saved.id)}`,
		);
		expect(rows[0]?.bytes).toBeLessThan(1_900_000);
	}
});
