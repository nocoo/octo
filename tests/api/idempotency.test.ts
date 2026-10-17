import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec, type D1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";

function e2eD1(): D1Exec {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) {
		throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	}
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

async function seedWriteKey(d1: D1Exec): Promise<string> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const now = Date.now();
	d1([
		"--command",
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-${material.keyid}', '${secretHash}', 'admin', 'r,w,u,d', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
	]);
	return material.plaintext;
}

function batchCreateHeaders(token: string, idemKey: string) {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"Idempotency-Key": idemKey,
	};
}

function batchCreateBody(title: string) {
	return JSON.stringify({
		items: [{ space: "kb", title, body: "b", type: "note", tags: [] }],
	});
}

describe("idempotency", () => {
	it("replays batch writes for the same Idempotency-Key", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const body = batchCreateBody("idem");
		const headers = batchCreateHeaders(token, "batch-create-1");
		const first = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers,
			body,
		});
		expect(first.status).toBe(200);
		const second = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers,
			body,
		});
		expect(second.status).toBe(200);
		expect(second.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
	});

	it("returns idempotency_conflict when the key is reused with a different body", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const headers = batchCreateHeaders(token, "batch-create-conflict");
		await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers,
			body: batchCreateBody("a"),
		});
		const conflict = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers,
			body: batchCreateBody("b"),
		});
		expect(conflict.status).toBe(409);
		const envelope = (await conflict.json()) as { error: { code: string } };
		expect(envelope.error.code).toBe("idempotency_conflict");
	});

	it("rejects invalid Idempotency-Key values", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const res = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"Idempotency-Key": "bad\tkey",
			},
			body: batchCreateBody("x"),
		});
		expect(res.status).toBe(400);
	});

	it("rejects an empty Idempotency-Key header", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const res = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"Idempotency-Key": "",
			},
			body: batchCreateBody("x"),
		});
		expect(res.status).toBe(400);
	});

	it("replays concurrent requests that share the same idempotency key", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const headers = batchCreateHeaders(token, `concurrent-${Date.now()}`);
		const body = batchCreateBody("concurrent");
		const responses = await Promise.all(
			Array.from({ length: 8 }, () =>
				fetch(`${base}/api/v1/memories:batchCreate`, { method: "POST", headers, body }),
			),
		);
		for (const res of responses) {
			expect(res.status).toBe(200);
		}
		const replayed = responses.filter((res) => res.headers.get("Idempotent-Replayed") === "true");
		expect(replayed.length).toBeGreaterThanOrEqual(1);
		const bodies = await Promise.all(responses.map((res) => res.json()));
		for (const parsed of bodies) {
			expect(parsed).toEqual(bodies[0]);
		}
	});

	it("conflicts concurrent hash-mismatch retries on the same key", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const idemKey = `hash-mismatch-${Date.now()}`;
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"Idempotency-Key": idemKey,
		};
		const [first, second] = await Promise.all([
			fetch(`${base}/api/v1/memories:batchCreate`, {
				method: "POST",
				headers,
				body: batchCreateBody("one"),
			}),
			fetch(`${base}/api/v1/memories:batchCreate`, {
				method: "POST",
				headers,
				body: batchCreateBody("two"),
			}),
		]);
		const statuses = [first.status, second.status].sort();
		expect(statuses).toEqual([200, 409]);
	});

	it("does not cross-isolate idempotency keys", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const tokenA = await seedWriteKey(d1);
		const tokenB = await seedWriteKey(d1);
		const idemKey = `cross-key-${Date.now()}`;
		const body = batchCreateBody("isolated");
		const resA = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: batchCreateHeaders(tokenA, idemKey),
			body,
		});
		const resB = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: batchCreateHeaders(tokenB, idemKey),
			body,
		});
		expect(resA.status).toBe(200);
		expect(resB.status).toBe(200);
		expect(resB.headers.get("Idempotent-Replayed")).not.toBe("true");
		const bodyA = (await resA.json()) as { results: Array<{ item?: { id: string } }> };
		const bodyB = (await resB.json()) as { results: Array<{ item?: { id: string } }> };
		expect(bodyA.results[0]?.item?.id).not.toBe(bodyB.results[0]?.item?.id);
	});
});
