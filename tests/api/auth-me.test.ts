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

describe("GET /api/v1/me", () => {
	it("returns the key profile for a valid bearer token", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const material = generateApiKeyMaterial();
		const secretHash = await hashSecret(pepper, material.secret);
		const now = Date.now();
		d1([
			"--command",
			`INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('sp-me', 'alpha', 'Alpha', '', NULL, ${now}, ${now})`,
		]);
		d1([
			"--command",
			`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-bot', '${secretHash}', 'admin', 'r,w,u,d', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
		]);
		const res = await fetch(`${base}/api/v1/me`, {
			headers: { Authorization: `Bearer ${material.plaintext}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			spaces: Array<{ id: string; slug: string; name: string }>;
		};
		expect(body).toMatchObject({
			id: material.keyid,
			name: "e2e-bot",
			role: "admin",
			ops: ["d", "r", "u", "w"],
			scope: "all",
			own_entries_only: false,
			auto_own_space: false,
			expires_at: null,
		});
		expect(body.spaces).toEqual(
			expect.arrayContaining([{ id: "sp-me", slug: "alpha", name: "Alpha" }]),
		);
		const denied = await fetch(`${base}/api/v1/me`);
		expect(denied.status).toBe(401);
		expect(await denied.json()).toMatchObject({ error: { code: "unauthenticated" } });
		const bad = await fetch(`${base}/api/v1/me`, {
			headers: {
				Authorization:
					"Bearer octo_AAAAAAAAAAAA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			},
		});
		expect(bad.status).toBe(401);
		expect(await bad.json()).toMatchObject({ error: { code: "unauthenticated" } });
	});

	it("rejects wrong secret, expired, revoked, and stale previous secrets", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const now = Date.now();
		const insert = async (opts: {
			expiresAt?: number | null;
			revokedAt?: number | null;
			prevSecret?: string;
			prevValidUntil?: number | null;
		}) => {
			const material = generateApiKeyMaterial();
			const secretHash = await hashSecret(pepper, material.secret);
			const prevHash = opts.prevSecret ? await hashSecret(pepper, opts.prevSecret) : null;
			d1([
				"--command",
				`INSERT INTO api_keys (id, name, secret_hash, prev_secret_hash, prev_valid_until, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, revoked_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-${material.keyid}', '${secretHash}', ${prevHash ? `'${prevHash}'` : "NULL"}, ${opts.prevValidUntil ?? "NULL"}, 'admin', 'r', 'all', '[]', 0, 0, ${opts.expiresAt ?? "NULL"}, ${opts.revokedAt ?? "NULL"}, ${now}, ${now})`,
			]);
			return material;
		};
		const expectUnauth = async (token: string) => {
			const res = await fetch(`${base}/api/v1/me`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(401);
			expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
		};
		const live = await insert({});
		const wrong = generateApiKeyMaterial();
		await expectUnauth(`octo_${live.keyid}_${wrong.secret}`);
		const expired = await insert({ expiresAt: now - 1 });
		await expectUnauth(expired.plaintext);
		const revoked = await insert({ revokedAt: now });
		await expectUnauth(revoked.plaintext);
		const prevSecret = generateApiKeyMaterial().secret;
		const rotated = await insert({
			prevSecret,
			prevValidUntil: now + 60_000,
		});
		const prevPlain = `octo_${rotated.keyid}_${prevSecret}`;
		const graceOk = await fetch(`${base}/api/v1/me`, {
			headers: { Authorization: `Bearer ${prevPlain}` },
		});
		expect(graceOk.status).toBe(200);
		const currentOk = await fetch(`${base}/api/v1/me`, {
			headers: { Authorization: `Bearer ${rotated.plaintext}` },
		});
		expect(currentOk.status).toBe(200);
		d1([
			"--command",
			`UPDATE api_keys SET prev_valid_until = ${now - 1} WHERE id = '${rotated.keyid}'`,
		]);
		await expectUnauth(prevPlain);
		const stillCurrent = await fetch(`${base}/api/v1/me`, {
			headers: { Authorization: `Bearer ${rotated.plaintext}` },
		});
		expect(stillCurrent.status).toBe(200);
	});
});
