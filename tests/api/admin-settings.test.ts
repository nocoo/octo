import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { ADMIN_ORIGIN_PROD } from "../../apps/web/src/server/auth/origin";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey } from "../fixtures/l2-batch";

async function accessHeaders(): Promise<Record<string, string>> {
	const state = await loadJwksState();
	return {
		"Cf-Access-Jwt-Assertion": await signAccessJwt(state, {
			iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
			aud: L2_ACCESS_AUD,
			exp: Math.floor(Date.now() / 1000) + 3600,
			email: "settings-e2e@local",
		}),
		Origin: ADMIN_ORIGIN_PROD,
		"Content-Type": "application/json",
	};
}

const path = "/api/admin/settings/embedding";

describe("Access-only embedding settings", () => {
	it("requires Access on GET/PUT/test and matching origin on writes", async () => {
		const headers = await accessHeaders();
		const apiKey = await seedKey(await e2eD1());
		for (const [method, suffix] of [
			["GET", ""],
			["PUT", ""],
			["POST", "/test"],
		] as const) {
			for (const auth of [{}, { Authorization: `Bearer ${apiKey.token}` }]) {
				const response = await fetch(`${base}${path}${suffix}`, {
					method,
					headers: { ...auth, Origin: ADMIN_ORIGIN_PROD },
					...(method === "GET" ? {} : { body: "{}" }),
				});
				expect(response.status).toBe(401);
			}
			if (method !== "GET") {
				const rejected = await fetch(`${base}${path}${suffix}`, {
					method,
					headers: { ...headers, Origin: "https://evil.example" },
					body: "{}",
				});
				expect(rejected.status).toBe(403);
			}
		}
	});

	it("encrypts, preserves, replaces and clears credentials; tests current and unsaved config safely", async () => {
		const headers = await accessHeaders();
		const d1 = await e2eD1();
		const [profile] = await query<{ model: string; dims: number }>(
			d1,
			"SELECT model, dims FROM embedding_profiles WHERE active = 1",
		);
		if (!profile) throw new Error("active fixture profile required");
		const initial = await fetch(`${base}${path}`, { headers });
		expect(initial.status).toBe(200);
		expect(await initial.json()).toMatchObject({
			model: profile.model,
			dims: profile.dims,
			backfill_enabled: false,
		});
		const secret = "settings-e2e-private-key-ABCD";
		let expectedSecret = secret;
		let mode: "ok" | "wrong-dims" | "failure" | "redirect" | "parse" = "ok";
		let calls = 0;
		const server = createServer(async (req, res) => {
			expect(req.url).toBe("/v1/embeddings");
			expect(req.headers.authorization).toBe(`Bearer ${expectedSecret}`);
			expect(req.headers["user-agent"]).toMatch(/^octo\//);
			let body = "";
			for await (const chunk of req) body += chunk;
			const request = JSON.parse(body) as { model: string; input: string[] };
			expect(request.model).toBe(profile.model);
			res.setHeader("Content-Type", "application/json");
			if (request.input.length !== 1 || request.input[0] !== "Octo embedding connection test.") {
				res.end(
					JSON.stringify({
						data: request.input.map((_, index) => ({
							index,
							embedding: Array.from({ length: profile.dims }, (_, dimension) =>
								dimension === 0 ? 1 : 0,
							),
						})),
					}),
				);
				return;
			}
			calls++;
			if (mode === "redirect") {
				res.statusCode = 302;
				res.setHeader("Location", "/private-redirect-target");
				res.end(secret);
				return;
			}
			if (mode === "parse") {
				res.end(secret);
				return;
			}
			if (mode === "failure") {
				res.statusCode = 403;
				res.end(JSON.stringify({ error: secret }));
				return;
			}
			const vector = Array.from({ length: mode === "wrong-dims" ? 2 : profile.dims }, (_, i) =>
				i === 0 ? 1 : 0,
			);
			res.end(JSON.stringify({ data: [{ index: 0, embedding: vector }] }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("stub address unavailable");
			const config = {
				base_url: `http://127.0.0.1:${address.port}/v1/`,
				api_key: secret,
				model: profile.model,
				dims: profile.dims,
				backfill_enabled: false,
			};
			const post = (body: unknown) =>
				fetch(`${base}${path}/test`, { method: "POST", headers, body: JSON.stringify(body) });
			const put = (body: unknown) =>
				fetch(`${base}${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
			const unsaved = await post(config);
			expect(unsaved.status).toBe(200);
			expect(await unsaved.json()).toEqual({
				latency_ms: expect.any(Number),
				dims: profile.dims,
				match: true,
				error_code: null,
				reason: null,
			});
			expect(await query(d1, "SELECT * FROM settings WHERE key GLOB 'embedding.*'")).toEqual([]);
			const saved = await put(config);
			expect(saved.status).toBe(200);
			expect(await saved.json()).toMatchObject({ api_key_set: true, api_key_mask: "****ABCD" });
			const rows = await query<{
				value: string | null;
				ciphertext: string;
				iv: string;
				key_version: number;
				updated_by: string;
			}>(
				d1,
				"SELECT value, hex(ciphertext) AS ciphertext, hex(iv) AS iv, key_version, updated_by FROM settings WHERE key = 'embedding.api_key'",
			);
			expect(rows[0]).toMatchObject({
				value: null,
				key_version: 1,
				updated_by: "admin:settings-e2e@local",
			});
			expect(rows[0]?.iv).toHaveLength(24);
			expect(JSON.stringify(rows)).not.toContain(secret);
			await put({ backfill_enabled: true });
			expect(await (await post({})).json()).toMatchObject({ match: true, dims: profile.dims });
			mode = "wrong-dims";
			expect(await (await post({})).json()).toMatchObject({
				match: false,
				dims: 2,
				error_code: "vector_dimension_mismatch",
				reason: { stage: "dims" },
			});
			mode = "failure";
			const failed = await post({});
			expect(await failed.json()).toEqual({
				latency_ms: expect.any(Number),
				dims: null,
				match: false,
				error_code: "embedder_unavailable",
				reason: { stage: "status", upstream_status: 403 },
			});
			for (const failure of ["redirect", "parse"] as const) {
				mode = failure;
				const response = await post({});
				const result = await response.json();
				expect(result).toMatchObject({
					dims: null,
					match: false,
					error_code: "embedder_unavailable",
					reason:
						failure === "redirect"
							? { stage: "redirect", upstream_status: 302 }
							: { stage: "parse" },
				});
				expect(JSON.stringify(result)).not.toContain(secret);
			}
			await d1([
				"--command",
				"UPDATE settings SET key_version = 2 WHERE key = 'embedding.api_key'",
			]);
			expect(await (await post({})).json()).toMatchObject({
				error_code: "embedder_unavailable",
				reason: { stage: "decrypt" },
			});
			await d1([
				"--command",
				"UPDATE settings SET key_version = 1 WHERE key = 'embedding.api_key'",
			]);
			for (const invalid of [
				{ dims: profile.dims === 1 ? 2 : 1 },
				{ model: "other-model" },
				{ base_url: "http://10.0.0.1" },
				{ base_url: "https://gateway.example?secret=x" },
			]) {
				const response = await put(invalid);
				expect(response.status).toBe(400);
			}
			expect((await post({ model: "other-model" })).status).toBe(400);
			for (const [method, suffix] of [
				["PUT", ""],
				["POST", "/test"],
			] as const) {
				expect(
					(await fetch(`${base}${path}${suffix}`, { method, headers, body: "{" })).status,
				).toBe(400);
			}
			expectedSecret = "replacement-EFGH";
			await put({ api_key: expectedSecret });
			expect(await (await fetch(`${base}${path}`, { headers })).json()).toMatchObject({
				api_key_mask: "****EFGH",
			});
			await put({ api_key: null });
			expect(await (await fetch(`${base}${path}`, { headers })).json()).toMatchObject({
				api_key_set: false,
				api_key_mask: null,
			});
			expect(await (await post({})).json()).toMatchObject({ error_code: "embedder_unavailable" });
			expect(calls).toBe(6);
		} finally {
			await d1(["--command", "DELETE FROM settings WHERE key GLOB 'embedding.*'"]);
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});
