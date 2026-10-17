import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { ACCESS_AUD, ACCESS_TEAM_DOMAIN } from "../lib/access-config";
import { ApiError } from "../lib/errors";
import {
	isDevBypassHost,
	isLoopbackHost,
	requestHostname,
	resetJwksCache,
	resolveAccessIdentity,
} from "./access";

function env(partial: Partial<Env> = {}): Env {
	return {
		DB: {} as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("x")) } as unknown as Fetcher,
		...partial,
	};
}

function b64url(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) {
		s += String.fromCharCode(b);
	}
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(
	key: CryptoKey,
	payload: Record<string, unknown>,
	kid = "k1",
): Promise<string> {
	const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid })));
	const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
	const sig = new Uint8Array(
		await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			key,
			new TextEncoder().encode(`${header}.${body}`),
		),
	);
	return `${header}.${body}.${b64url(sig)}`;
}

async function rsaPair(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	) as Promise<CryptoKeyPair>;
}

const testEnv = {
	RESOURCE_ENV: "test",
	CF_ACCESS_TEAM_DOMAIN: "http://127.0.0.1:17057",
	CF_ACCESS_AUD: "octo-e2e",
	ACCESS_JWKS_URL: "http://127.0.0.1:17057/cdn-cgi/access/certs",
};

afterEach(() => {
	resetJwksCache();
});

describe("hosts", () => {
	it("detects loopback and the local dev host", () => {
		expect(isLoopbackHost("127.0.0.1")).toBe(true);
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("::1")).toBe(true);
		expect(isLoopbackHost("[::1]")).toBe(true);
		expect(isLoopbackHost("octo.hexly.ai")).toBe(false);
		expect(isDevBypassHost(new Request("https://octo.dev.hexly.ai/api/admin/whoami"))).toBe(true);
		expect(
			requestHostname(
				new Request("http://127.0.0.1:37059/api", { headers: { Host: "octo.dev.hexly.ai" } }),
			),
		).toBe("octo.dev.hexly.ai");
		expect(requestHostname(new Request("http://127.0.0.1:17059/api"))).toBe("127.0.0.1");
	});
});

describe("resolveAccessIdentity", () => {
	it("bypasses only in development on the allowed hosts", async () => {
		const id = await resolveAccessIdentity(
			new Request("https://octo.dev.hexly.ai/api/admin/whoami"),
			env({ RESOURCE_ENV: "development", ACCESS_DEV_BYPASS_EMAIL: "dev@local" }),
		);
		expect(id.email).toBe("dev@local");
		await expect(
			resolveAccessIdentity(
				new Request("https://octo.hexly.ai/api/admin/whoami"),
				env({ RESOURCE_ENV: "development", ACCESS_DEV_BYPASS_EMAIL: "dev@local" }),
			),
		).rejects.toMatchObject({ code: "unauthenticated" });
		await expect(
			resolveAccessIdentity(
				new Request("https://octo.dev.hexly.ai/api/admin/whoami"),
				env({ ACCESS_DEV_BYPASS_EMAIL: "dev@local" }),
			),
		).rejects.toMatchObject({ code: "unauthenticated" });
	});

	it("verifies RS256 tokens, caches JWKS, and rejects bad claims", async () => {
		const pair = await rsaPair();
		const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & {
			kid?: string;
		};
		jwk.kid = "k1";
		const now = Math.floor(Date.now() / 1000);
		const token = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: testEnv.CF_ACCESS_AUD,
			exp: now + 60,
			nbf: now - 10,
			email: "a@b.c",
		});
		let fetches = 0;
		const fetchImpl = async () => {
			fetches += 1;
			return Response.json({ keys: [jwk] });
		};
		const req = (jwt: string) =>
			new Request("http://127.0.0.1:17059/api/admin/whoami", {
				headers: { "Cf-Access-Jwt-Assertion": jwt },
			});
		const identity = await resolveAccessIdentity(req(token), env(testEnv), fetchImpl);
		expect(identity.email).toBe("a@b.c");
		await resolveAccessIdentity(req(token), env(testEnv), fetchImpl);
		expect(fetches).toBe(1);
		const arrayAud = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: [testEnv.CF_ACCESS_AUD],
			exp: now + 60,
			email: "a@b.c",
		});
		expect((await resolveAccessIdentity(req(arrayAud), env(testEnv), fetchImpl)).email).toBe(
			"a@b.c",
		);
		const badAud = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: "wrong",
			exp: now + 60,
			email: "a@b.c",
		});
		const badIss = await signJwt(pair.privateKey, {
			iss: "https://evil.example",
			aud: testEnv.CF_ACCESS_AUD,
			exp: now + 60,
			email: "a@b.c",
		});
		const expired = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: testEnv.CF_ACCESS_AUD,
			exp: now - 120,
			email: "a@b.c",
		});
		const future = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: testEnv.CF_ACCESS_AUD,
			exp: now + 60,
			nbf: now + 120,
			email: "a@b.c",
		});
		const noEmail = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: testEnv.CF_ACCESS_AUD,
			exp: now + 60,
		});
		const unknownKid = await signJwt(
			pair.privateKey,
			{
				iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
				aud: testEnv.CF_ACCESS_AUD,
				exp: now + 60,
				email: "a@b.c",
			},
			"missing",
		);
		for (const jwt of [badAud, badIss, expired, future, noEmail, unknownKid, "nope", "a.b.c"]) {
			await expect(resolveAccessIdentity(req(jwt), env(testEnv), fetchImpl)).rejects.toMatchObject({
				code: "unauthenticated",
			});
		}
		const hs = `${b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", kid: "k1" })))}.${b64url(new TextEncoder().encode(JSON.stringify({ iss: testEnv.CF_ACCESS_TEAM_DOMAIN, aud: testEnv.CF_ACCESS_AUD, exp: now + 60, email: "a@b.c" })))}.aa`;
		await expect(resolveAccessIdentity(req(hs), env(testEnv), fetchImpl)).rejects.toMatchObject({
			code: "unauthenticated",
		});
		resetJwksCache();
		await expect(
			resolveAccessIdentity(
				req(token),
				env(testEnv),
				async () => new Response("no", { status: 500 }),
			),
		).rejects.toMatchObject({ code: "unauthenticated" });
		await expect(
			resolveAccessIdentity(req(token), env(testEnv), async () => {
				throw new Error("down");
			}),
		).rejects.toMatchObject({ code: "unauthenticated" });
		await expect(
			resolveAccessIdentity(req(token), env(testEnv), async () => new Response("not-json")),
		).rejects.toMatchObject({ code: "unauthenticated" });
		await expect(
			resolveAccessIdentity(req(token), env(testEnv), async () =>
				Response.json({ keys: [{ kty: "oct", kid: "k1", alg: "HS256" }] }),
			),
		).rejects.toMatchObject({ code: "unauthenticated" });
		resetJwksCache();
		const skewOk = await signJwt(pair.privateKey, {
			iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
			aud: testEnv.CF_ACCESS_AUD,
			exp: now - 30,
			email: "a@b.c",
		});
		expect((await resolveAccessIdentity(req(skewOk), env(testEnv), fetchImpl)).email).toBe("a@b.c");
	});

	it("refreshes JWKS on unknown kid and after the cache ttl", async () => {
		const pair = await rsaPair();
		const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & {
			kid?: string;
		};
		jwk.kid = "k2";
		const now = Math.floor(Date.now() / 1000);
		const token = await signJwt(
			pair.privateKey,
			{
				iss: testEnv.CF_ACCESS_TEAM_DOMAIN,
				aud: testEnv.CF_ACCESS_AUD,
				exp: now + 3600,
				email: "a@b.c",
			},
			"k2",
		);
		let fetches = 0;
		const fetchImpl = async () => {
			fetches += 1;
			if (fetches === 1) {
				return Response.json({ keys: [] });
			}
			return Response.json({ keys: [jwk] });
		};
		const req = new Request("http://127.0.0.1/api/admin/whoami", {
			headers: { "Cf-Access-Jwt-Assertion": token },
		});
		expect((await resolveAccessIdentity(req, env(testEnv), fetchImpl)).email).toBe("a@b.c");
		expect(fetches).toBe(2);
		resetJwksCache();
		let t = Date.now();
		const ttlFetch = async () => Response.json({ keys: [jwk] });
		await resolveAccessIdentity(req, env(testEnv), ttlFetch, () => t);
		await resolveAccessIdentity(req, env(testEnv), ttlFetch, () => t);
		t += 11 * 60 * 1000;
		await resolveAccessIdentity(req, env(testEnv), ttlFetch, () => t);
	});

	it("uses test JWKS overrides only when RESOURCE_ENV is test", async () => {
		const headerMissing = b64url(
			new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "k1" })),
		);
		await expect(
			resolveAccessIdentity(
				new Request("https://octo.hexly.ai/api/admin/whoami", {
					headers: { "Cf-Access-Jwt-Assertion": `${headerMissing}.e.s` },
				}),
				env({ RESOURCE_ENV: "test" }),
			),
		).rejects.toMatchObject({ code: "internal" });
		let jwks = "";
		const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "k1" })));
		const body = b64url(new TextEncoder().encode(JSON.stringify({})));
		await expect(
			resolveAccessIdentity(
				new Request("https://octo.hexly.ai/api/admin/whoami", {
					headers: { "Cf-Access-Jwt-Assertion": `${header}.${body}.sig` },
				}),
				env({
					ACCESS_JWKS_URL: "http://127.0.0.1:9/cdn-cgi/access/certs",
					CF_ACCESS_TEAM_DOMAIN: "http://127.0.0.1:9",
					CF_ACCESS_AUD: "x",
				}),
				async (input) => {
					jwks = String(input);
					return Response.json({ keys: [] });
				},
			),
		).rejects.toBeInstanceOf(ApiError);
		expect(jwks).toBe(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
		expect(ACCESS_AUD.length).toBeGreaterThan(8);
	});
});
