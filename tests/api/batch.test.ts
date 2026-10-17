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
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-batch', '${secretHash}', 'admin', 'r,w,u,d', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
	]);
	return material.plaintext;
}

describe("batch memory endpoints", () => {
	it("POST /api/v1/memories:batchCreate returns per-item results", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const res = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [
					{ space: "kb", title: "one", body: "body", type: "note", tags: ["a"] },
					{ space: "kb", title: "two", body: "body", type: "note", tags: [] },
				],
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { results: Array<{ ok: boolean; item?: { id: string } }> };
		expect(body.results).toHaveLength(2);
		expect(body.results.every((row) => row.ok)).toBe(true);
	});

	it("rejects unauthenticated batch writes", async () => {
		const res = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ space: "kb", title: "x", body: "b", type: "note", tags: [] }],
			}),
		});
		expect(res.status).toBe(401);
	});

	it("returns payload_too_large for more than 100 items", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const items = Array.from({ length: 101 }, () => ({
			space: "kb",
			title: "x",
			body: "b",
			type: "note",
			tags: [],
		}));
		const res = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ items }),
		});
		expect(res.status).toBe(413);
	});

	it("POST /api/v1/memories:batchUpdate and batchDelete accept ids", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const token = await seedWriteKey(d1);
		const created = await fetch(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ space: "kb", title: "x", body: "b", type: "note", tags: [] }],
			}),
		});
		const createdBody = (await created.json()) as {
			results: Array<{ ok: boolean; item?: { id: string; version: number } }>;
		};
		const item = createdBody.results[0]?.item;
		expect(item?.id).toBeTruthy();
		const updated = await fetch(`${base}/api/v1/memories:batchUpdate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ id: item?.id, title: "y", expected_version: item?.version ?? 1 }],
			}),
		});
		expect(updated.status).toBe(200);
		const deleted = await fetch(`${base}/api/v1/memories:batchDelete`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ids: [item?.id] }),
		});
		expect(deleted.status).toBe(200);
	});
});
