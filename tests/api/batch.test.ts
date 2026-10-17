import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec, type D1Exec } from "../../scripts/local-d1";
import { afterD1Exec, fetchWithRetry } from "./helpers";

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

async function seedKey(d1: D1Exec, ops: string): Promise<string> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const now = Date.now();
	d1([
		"--command",
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-${material.keyid}', '${secretHash}', 'admin', '${ops}', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
	]);
	await afterD1Exec();
	return material.plaintext;
}

async function seedWriteKey(d1: D1Exec): Promise<string> {
	return seedKey(d1, "r,w,u,d");
}

async function seedKbSpace(d1: D1Exec): Promise<void> {
	const now = Date.now();
	d1([
		"--command",
		`INSERT OR IGNORE INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('sp-kb', 'kb', 'KB', '', NULL, ${now}, ${now})`,
	]);
	await afterD1Exec();
}

describe("batch memory endpoints", () => {
	it("POST /api/v1/memories:batchCreate returns per-item results", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		await seedKbSpace(d1);
		const token = await seedWriteKey(d1);
		const res = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
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
		const res = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
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
		await seedKbSpace(d1);
		const token = await seedWriteKey(d1);
		const items = Array.from({ length: 101 }, () => ({
			space: "kb",
			title: "x",
			body: "b",
			type: "note",
			tags: [],
		}));
		const res = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ items }),
		});
		expect(res.status).toBe(413);
	});

	it("returns per-item forbidden for read-only keys", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		await seedKbSpace(d1);
		const token = await seedKey(d1, "r");
		const res = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ space: "kb", title: "x", body: "b", type: "note", tags: [] }],
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(body.results[0]?.ok).toBe(false);
		expect(body.results[0]?.error?.code).toBe("forbidden");
	});

	it("batchUpdate reports version_conflict and not_found per item", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		await seedKbSpace(d1);
		const token = await seedWriteKey(d1);
		const created = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
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
		const updated = await fetchWithRetry(`${base}/api/v1/memories:batchUpdate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [
					{ id: item?.id, title: "y", expected_version: 99 },
					{ id: "01missing0000000000000000", title: "z", expected_version: 1 },
				],
			}),
		});
		expect(updated.status).toBe(200);
		const updatedBody = (await updated.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(updatedBody.results[0]?.error?.code).toBe("version_conflict");
		expect(updatedBody.results[1]?.error?.code).toBe("not_found");
	});

	it("POST /api/v1/memories:batchUpdate and batchDelete accept ids", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		await seedKbSpace(d1);
		const token = await seedWriteKey(d1);
		const created = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
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
		const updated = await fetchWithRetry(`${base}/api/v1/memories:batchUpdate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ id: item?.id, title: "y", expected_version: item?.version ?? 1 }],
			}),
		});
		expect(updated.status).toBe(200);
		const updatedBody = (await updated.json()) as {
			results: Array<{ ok: boolean; item?: { title: string; version: number } }>;
		};
		expect(updatedBody.results[0]?.ok).toBe(true);
		expect(updatedBody.results[0]?.item?.title).toBe("y");
		expect(updatedBody.results[0]?.item?.version).toBe(2);
		const deleted = await fetchWithRetry(`${base}/api/v1/memories:batchDelete`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ids: [item?.id] }),
		});
		expect(deleted.status).toBe(200);
		const deletedBody = (await deleted.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(deletedBody.results[0]?.ok).toBe(true);
		const missingDelete = await fetchWithRetry(`${base}/api/v1/memories:batchDelete`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ids: [item?.id, "01missing0000000000000000"] }),
		});
		const missingBody = (await missingDelete.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(missingBody.results[0]?.error?.code).toBe("not_found");
		expect(missingBody.results[1]?.error?.code).toBe("not_found");
	});

	it("rejects unauthenticated batchUpdate and batchDelete", async () => {
		const update = await fetchWithRetry(`${base}/api/v1/memories:batchUpdate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ id: "01missing", title: "t", expected_version: 1 }],
			}),
		});
		expect(update.status).toBe(401);
		const del = await fetchWithRetry(`${base}/api/v1/memories:batchDelete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ids: ["01missing"] }),
		});
		expect(del.status).toBe(401);
	});

	it("returns per-item forbidden for read-only batchUpdate and batchDelete", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		await seedKbSpace(d1);
		const writeToken = await seedWriteKey(d1);
		const created = await fetchWithRetry(`${base}/api/v1/memories:batchCreate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${writeToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ space: "kb", title: "x", body: "b", type: "note", tags: [] }],
			}),
		});
		const createdBody = (await created.json()) as {
			results: Array<{ item?: { id: string; version: number } }>;
		};
		const item = createdBody.results[0]?.item;
		const readToken = await seedKey(d1, "r");
		const updated = await fetchWithRetry(`${base}/api/v1/memories:batchUpdate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${readToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ id: item?.id, title: "nope", expected_version: item?.version ?? 1 }],
			}),
		});
		const updatedBody = (await updated.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(updatedBody.results[0]?.error?.code).toBe("forbidden");
		const deleted = await fetchWithRetry(`${base}/api/v1/memories:batchDelete`, {
			method: "POST",
			headers: { Authorization: `Bearer ${readToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ids: [item?.id] }),
		});
		const deletedBody = (await deleted.json()) as {
			results: Array<{ ok: boolean; error?: { code: string } }>;
		};
		expect(deletedBody.results[0]?.error?.code).toBe("forbidden");
	});
});
