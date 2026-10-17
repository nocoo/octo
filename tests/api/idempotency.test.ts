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
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-idem', '${secretHash}', 'admin', 'r,w,u,d', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
	]);
	return material.plaintext;
}

describe("idempotency", () => {
	it("replays batch writes for the same Idempotency-Key", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const body = JSON.stringify({
			items: [{ space: "kb", title: "idem", body: "b", type: "note", tags: [] }],
		});
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"Idempotency-Key": "batch-create-1",
		};
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
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"Idempotency-Key": "batch-create-conflict",
		};
		await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				items: [{ space: "kb", title: "a", body: "b", type: "note", tags: [] }],
			}),
		});
		const conflict = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				items: [{ space: "kb", title: "b", body: "b", type: "note", tags: [] }],
			}),
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
			body: JSON.stringify({
				items: [{ space: "kb", title: "x", body: "b", type: "note", tags: [] }],
			}),
		});
		expect(res.status).toBe(400);
	});
});
