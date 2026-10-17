import { beforeAll, describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const origin = "https://octo.hexly.ai";
const email = "admin-resources@local";
let jwt: string;

beforeAll(async () => {
	jwt = await signAccessJwt(await loadJwksState(), {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email,
	});
});

function admin(path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
	return fetch(`${base}/api/admin/${path}`, {
		method,
		headers: {
			"Cf-Access-Jwt-Assertion": jwt,
			Origin: origin,
			"Content-Type": "application/json",
			...extra,
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

type KeyMetadata = {
	id: string;
	name: string;
	role: string;
	ops: string;
	scope: string;
	space_ids: string[];
	own_entries_only: boolean;
	auto_own_space: boolean;
	revoked_at: string | null;
};
async function mint(role = "admin") {
	const response = await admin("keys", "POST", { name: `m7-${crypto.randomUUID()}`, role });
	expect(response.status).toBe(201);
	return (await response.json()) as { key: KeyMetadata; plaintext: string };
}
function me(token: string) {
	return fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
}

describe("admin resources access boundary", () => {
	it("requires Access for every method and same-origin for every mutation", async () => {
		const routes = [
			["GET", "keys"],
			["POST", "keys"],
			["GET", "keys/missing"],
			["PATCH", "keys/missing"],
			["DELETE", "keys/missing"],
			["POST", "keys/missing/rotate"],
			["POST", "keys/missing/revoke"],
			["GET", "spaces"],
			["POST", "spaces"],
			["GET", "spaces/missing"],
			["PATCH", "spaces/missing"],
			["DELETE", "spaces/missing"],
		];
		const key = await mint();
		for (const [method, path] of routes) {
			if (!method || !path) throw new Error("invalid route case");
			for (const headers of [{}, { Authorization: `Bearer ${key.plaintext}` }]) {
				const response = await fetch(`${base}/api/admin/${path}`, {
					method,
					headers: { Origin: origin, ...headers },
				});
				expect(response.status).toBe(401);
				expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
			}
			if (method !== "GET") {
				const denied = await admin(path, method, {}, { Origin: "https://evil.example" });
				expect(denied.status).toBe(403);
				expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
			}
		}
	});
});

describe("admin keys real HTTP", () => {
	it("mints, lists, updates, rotates and revokes without exposing stored material", async () => {
		const observer = await mint();
		const observerHeaders = { Authorization: `Bearer ${observer.plaintext}` };
		const headResponse = await fetch(`${base}/api/v1/changes/head`, { headers: observerHeaders });
		expect(headResponse.status).toBe(200);
		const head = (await headResponse.json()) as { cursor: string };
		const minted = await mint("readonly");
		expect(minted.key).toMatchObject({
			space_ids: [],
			own_entries_only: false,
			auto_own_space: false,
		});
		expect(minted.key).not.toHaveProperty("space_ids_json");
		const path = `keys/${minted.key.id}`;
		expect(await (await admin(path)).json()).toMatchObject(minted.key);
		expect((await me(minted.plaintext)).status).toBe(200);
		const listed = await admin("keys");
		expect(listed.status).toBe(200);
		const list = (await listed.json()) as { items: KeyMetadata[]; next_cursor: null };
		expect(list.items).toContainEqual(
			expect.objectContaining({ id: minted.key.id, name: minted.key.name }),
		);
		expect(list.next_cursor).toBeNull();
		expect(JSON.stringify(list)).not.toMatch(/secret_hash|octo_[A-Z2-7]{12}_/);
		const patched = await admin(path, "PATCH", {
			role: "custom",
			ops: "r",
			scope: "all",
			own_entries_only: true,
		});
		expect(patched.status).toBe(200);
		expect(await patched.json()).toMatchObject({
			id: minted.key.id,
			role: "custom",
			own_entries_only: true,
		});
		const rotation = await admin(`${path}/rotate`, "POST", { grace_ms: 604800000 });
		expect(rotation.status).toBe(200);
		const rotated = (await rotation.json()) as { key: KeyMetadata; plaintext: string };
		expect(rotated.key.id).toBe(minted.key.id);
		expect((await me(minted.plaintext)).status).toBe(200);
		expect((await me(rotated.plaintext)).status).toBe(200);
		const immediate = await admin(`${path}/rotate`, "POST", {});
		expect(immediate.status).toBe(200);
		const latest = (await immediate.json()) as { plaintext: string };
		expect((await me(rotated.plaintext)).status).toBe(401);
		expect((await me(latest.plaintext)).status).toBe(200);
		const revoked = await admin(`${path}/revoke`, "POST");
		expect(revoked.status).toBe(200);
		expect(await revoked.json()).toMatchObject({
			id: minted.key.id,
			revoked_at: expect.stringMatching(/Z$/),
		});
		expect((await me(latest.plaintext)).status).toBe(401);
		expect((await admin(path)).status).toBe(200);
		expect((await admin(`${path}/rotate`, "POST", {})).status).toBe(409);
		const deletedKey = await mint();
		expect((await admin(`keys/${deletedKey.key.id}`, "DELETE")).status).toBe(200);
		expect((await me(deletedKey.plaintext)).status).toBe(401);
		expect((await admin(`keys/${deletedKey.key.id}`)).status).toBe(200);
		const publicChanges = await fetch(
			`${base}/api/v1/changes?cursor=${encodeURIComponent(head.cursor)}`,
			{ headers: observerHeaders },
		);
		expect(publicChanges.status).toBe(200);
		expect(await publicChanges.json()).toEqual({ items: [], next_cursor: null });
		expect(
			await (await fetch(`${base}/api/v1/changes/head`, { headers: observerHeaders })).json(),
		).toEqual(head);
	});

	it("uses array and boolean fields without accepting D1 storage aliases", async () => {
		const slug = `m7-${crypto.randomUUID()}`;
		const createdSpace = await admin("spaces", "POST", { slug, name: "Scoped" });
		expect(createdSpace.status).toBe(201);
		const space = (await createdSpace.json()) as { id: string };
		const created = await admin("keys", "POST", {
			name: `m7-${crypto.randomUUID()}`,
			role: "custom",
			ops: "r",
			scope: "spaces",
			space_ids: [space.id],
			own_entries_only: true,
			auto_own_space: false,
		});
		expect(created.status).toBe(201);
		const { key } = (await created.json()) as { key: KeyMetadata };
		for (const metadata of [key, await (await admin(`keys/${key.id}`)).json()]) {
			expect(metadata).toMatchObject({
				space_ids: [space.id],
				own_entries_only: true,
				auto_own_space: false,
			});
			expect(metadata).not.toHaveProperty("space_ids_json");
		}
		for (const body of [
			{ space_ids_json: "[]" },
			{ space_ids: "[]" },
			{ own_entries_only: 0 },
			{ auto_own_space: 1 },
		]) {
			expect(
				(await admin("keys", "POST", { name: `m7-${crypto.randomUUID()}`, role: "admin", ...body }))
					.status,
			).toBe(400);
			expect((await admin(`keys/${key.id}`, "PATCH", body)).status).toBe(400);
		}
		const patched = await admin(`keys/${key.id}`, "PATCH", {
			space_ids: [],
			own_entries_only: false,
			auto_own_space: true,
		});
		expect(patched.status).toBe(200);
		expect(await patched.json()).toMatchObject({
			space_ids: [],
			own_entries_only: false,
			auto_own_space: true,
		});
		expect((await admin(`spaces/${slug}`, "DELETE")).status).toBe(200);
	});

	it("rejects invalid permissions, unknown resources, duplicates and unbounded grace", async () => {
		const minted = await mint();
		const duplicate = await admin("keys", "POST", { name: minted.key.name, role: "admin" });
		expect(duplicate.status).toBe(409);
		for (const body of [
			{ role: "custom" },
			{ role: "readonly", ops: "w" },
			{ role: "invalid" },
			{ role: "custom", ops: "r,invalid", scope: "all" },
			{ role: "custom", ops: "r", scope: "spaces", space_ids: ["absent"] },
			{ secret_hash: "injection" },
		]) {
			expect(
				(await admin("keys", "POST", { name: `m7-${crypto.randomUUID()}`, ...body })).status,
			).toBe(400);
		}
		expect((await admin(`keys/${minted.key.id}`, "PATCH", { unknown: true })).status).toBe(400);
		for (const grace_ms of [-1, 604800001, 0.5]) {
			expect((await admin(`keys/${minted.key.id}/rotate`, "POST", { grace_ms })).status).toBe(400);
		}
		for (const [path, method] of [
			["keys/missing", "GET"],
			["keys/missing", "PATCH"],
			["keys/missing", "DELETE"],
			["keys/missing/rotate", "POST"],
			["keys/missing/revoke", "POST"],
		]) {
			if (!path || !method) throw new Error("invalid route case");
			const response = await admin(
				path,
				method,
				method === "GET" || method === "DELETE" ? undefined : {},
			);
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
		}
	});
});

describe("admin spaces real HTTP", () => {
	it("creates, lists, changes ownership and slug, and deletes an empty space", async () => {
		const owner = await mint("project");
		const slug = `m7-${crypto.randomUUID()}`;
		const created = await admin("spaces", "POST", {
			slug,
			name: "Admin space",
			owner_key_id: owner.key.id,
		});
		expect(created.status).toBe(201);
		const space = (await created.json()) as { id: string; slug: string };
		const list = await admin("spaces");
		expect(list.status).toBe(200);
		expect(await list.json()).toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({ id: space.id })]),
			next_cursor: null,
		});
		const detail = await admin(`spaces/${slug}`);
		expect(detail.status).toBe(200);
		expect(await detail.json()).toMatchObject({
			id: space.id,
			memory_count: 0,
			owner_key_id: owner.key.id,
		});
		const renamed = `${slug}-renamed`;
		const patched = await admin(`spaces/${slug}`, "PATCH", {
			slug: renamed,
			description: "Updated",
			owner_key_id: null,
		});
		expect(patched.status).toBe(200);
		expect(await patched.json()).toMatchObject({
			id: space.id,
			slug: renamed,
			description: "Updated",
			owner_key_id: null,
		});
		expect((await admin(`spaces/${slug}`)).status).toBe(404);
		const deleted = await admin(`spaces/${renamed}`, "DELETE");
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ id: space.id, slug: renamed, deleted: true });
		expect((await admin(`spaces/${renamed}`)).status).toBe(404);
	});

	it("rejects invalid owners, duplicates and deletion with live or trashed memories", async () => {
		const slug = `m7-${crypto.randomUUID()}`;
		for (const body of [{ slug: "Bad Slug" }, { owner_key_id: "missing" }, { unknown: true }]) {
			expect((await admin("spaces", "POST", { slug, name: "Space", ...body })).status).toBe(400);
		}
		expect((await admin("spaces", "POST", { slug, name: "Space" })).status).toBe(201);
		expect((await admin("spaces", "POST", { slug, name: "Duplicate" })).status).toBe(409);
		expect((await admin(`spaces/${slug}`, "PATCH", { owner_key_id: "missing" })).status).toBe(400);
		const key = await mint();
		const headers = {
			Authorization: `Bearer ${key.plaintext}`,
			"Content-Type": "application/json",
		};
		const created = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				space: slug,
				title: "Nonempty",
				body: "Keep",
				type: "note",
				tags: [],
			}),
		});
		expect(created.status).toBe(201);
		const memory = (await created.json()) as { id: string };
		expect((await admin(`spaces/${slug}`, "DELETE")).status).toBe(409);
		expect(
			(await fetch(`${base}/api/v1/memories/${memory.id}`, { method: "DELETE", headers })).status,
		).toBe(200);
		expect((await admin(`spaces/${slug}`, "DELETE")).status).toBe(409);
		for (const method of ["GET", "PATCH", "DELETE"]) {
			expect(
				(await admin("spaces/missing", method, method === "PATCH" ? { name: "New" } : undefined))
					.status,
			).toBe(404);
		}
	});
});
