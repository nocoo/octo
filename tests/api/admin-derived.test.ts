import { createServer } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";
import { waitForFixtureBackground } from "../../scripts/fixture-d1";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, seedSpace, sqlText } from "../fixtures/l2-batch";

let headers: Record<string, string>;

beforeAll(async () => {
	headers = {
		"Cf-Access-Jwt-Assertion": await signAccessJwt(await loadJwksState(), {
			iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
			aud: L2_ACCESS_AUD,
			exp: Math.floor(Date.now() / 1000) + 3600,
			email: "derived@local",
		}),
		Origin: "https://octo.hexly.ai",
		"Content-Type": "application/json",
	};
});

function admin(path: string, method = "GET", body?: unknown) {
	return fetch(`${base}/api/admin${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function drain(cron = false) {
	const response = await fetch(`${base}/api/__test/${cron ? "cron" : "background"}`, {
		method: "POST",
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ drained: true });
}

describe("admin profiles and durable derived work over HTTP", () => {
	it("protects profile discovery with Access, never with API keys", async () => {
		const token = (await seedKey(await e2eD1())).token;
		for (const auth of [
			{},
			{ Authorization: `Bearer ${token}` },
			{ "Cf-Access-Jwt-Assertion": "invalid" },
		]) {
			expect((await fetch(`${base}/api/admin/embedding-profiles`, { headers: auth })).status).toBe(
				401,
			);
		}
		const response = await admin("/embedding-profiles");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: expect.arrayContaining([
				expect.objectContaining({ id: "te3-small-1536", active: true, dims: 1536 }),
			]),
			active_profile: "te3-small-1536",
			next_cursor: null,
		});
	});

	it("acknowledges client vectors after commit and reconciles trash restore purge", async () => {
		const db = await e2eD1();
		const space = await seedSpace(db);
		const response = await admin("/memories", "POST", {
			space: space.slug,
			title: "derived vector",
			body: "body",
			type: "note",
			tags: [],
			vector: {
				profile: "te3-small-1536",
				values: Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
			},
		});
		expect(response.status).toBe(201);
		const { id } = (await response.json()) as { id: string };
		const vector = () =>
			query<{ indexed_at: number | null }>(
				db,
				`SELECT indexed_at FROM memory_vectors WHERE memory_id = ${sqlText(id)}`,
			);
		await drain();
		expect((await vector())[0]?.indexed_at).toEqual(expect.any(Number));
		expect((await admin(`/memories/${id}`, "DELETE")).status).toBe(200);
		await drain();
		expect((await vector())[0]?.indexed_at).toBeNull();
		expect((await admin(`/trash/${id}/restore`, "POST", {})).status).toBe(200);
		await drain();
		expect((await vector())[0]?.indexed_at).toEqual(expect.any(Number));
		await db([
			"--command",
			`UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = ${sqlText(id)}; UPDATE vector_sync_jobs SET due_at = 0 WHERE memory_id = ${sqlText(id)}`,
		]);
		await drain(true);
		expect((await vector())[0]?.indexed_at).toEqual(expect.any(Number));
		expect((await admin(`/memories/${id}`, "DELETE")).status).toBe(200);
		expect((await admin(`/trash/${id}`, "DELETE")).status).toBe(200);
		await drain();
		expect(await vector()).toEqual([]);
		const [job] = await query<{ generation: number; synced_generation: number }>(
			db,
			`SELECT generation, synced_generation FROM vector_sync_jobs WHERE memory_id = ${sqlText(id)}`,
		);
		expect(job?.synced_generation).toBe(job?.generation);
	});

	it("backfills committed text with a User-Agent and preserves caller ownership", async () => {
		await waitForFixtureBackground(base);
		const db = await e2eD1();
		const space = await seedSpace(db);
		const requests: Array<{
			input: string[];
			userAgent: string | undefined;
			authorization: string | undefined;
		}> = [];
		const secret = `fixture-${crypto.randomUUID()}`;
		const server = createServer(async (request, response) => {
			let text = "";
			for await (const chunk of request) text += chunk;
			requests.push({
				input: (JSON.parse(text) as { input: string[] }).input,
				userAgent: request.headers["user-agent"],
				authorization: request.headers.authorization,
			});
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					data: [
						{
							index: 0,
							embedding: Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
						},
					],
				}),
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("local stub unavailable");
			expect(
				(
					await admin("/settings/embedding", "PUT", {
						base_url: `http://127.0.0.1:${address.port}`,
						api_key: secret,
						backfill_enabled: true,
					})
				).status,
			).toBe(200);
			await drain();
			const response = await admin("/memories", "POST", {
				space: space.slug,
				title: "Backfill title",
				body: "Backfill body",
				type: "note",
				tags: [],
			});
			expect(response.status).toBe(201);
			const { id } = (await response.json()) as { id: string };
			await drain();
			expect(requests).toContainEqual({
				input: ["Backfill title\n\nBackfill body"],
				userAgent: expect.stringMatching(/^octo\//),
				authorization: `Bearer ${secret}`,
			});
			expect(
				await query(
					db,
					`SELECT memory.source_key_id, memory.version, vector.indexed_at, vector.dim FROM memories memory JOIN memory_vectors vector ON vector.memory_id = memory.id WHERE memory.id = ${sqlText(id)}`,
				),
			).toEqual([
				{
					source_key_id: "admin:derived@local",
					version: 1,
					indexed_at: expect.any(Number),
					dim: 1536,
				},
			]);
		} finally {
			await admin("/settings/embedding", "PUT", { backfill_enabled: false, api_key: null });
			await drain();
			await db(["--command", "DELETE FROM settings WHERE key GLOB 'embedding.*'"]);
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});
