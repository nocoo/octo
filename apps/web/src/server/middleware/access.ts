import type { Context, Next } from "hono";
import { type Env, resourceEnv } from "../env";
import { ACCESS_AUD, ACCESS_TEAM_DOMAIN } from "../lib/access-config";
import { ApiError } from "../lib/errors";

const JWKS_TTL_MS = 10 * 60 * 1000;
const SKEW_SEC = 60;

type Jwk = JsonWebKey & { kid?: string };
type JwksCache = { url: string; fetchedAt: number; keys: Jwk[] };

let jwksCache: JwksCache | null = null;

export function resetJwksCache(): void {
	jwksCache = null;
}

export function requestHostname(request: Request): string {
	const host = request.headers.get("Host");
	if (host && host.length > 0) {
		return (host.split(":")[0] ?? "").toLowerCase();
	}
	return new URL(request.url).hostname.toLowerCase();
}

export function isLoopbackHost(host: string): boolean {
	return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export function isDevBypassHost(request: Request): boolean {
	const host = requestHostname(request);
	return host === "octo.dev.hexly.ai" || isLoopbackHost(host);
}

function b64urlToBytes(value: string): Uint8Array {
	const padded =
		value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
	const bin = atob(padded);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

function unauthenticated(): ApiError {
	return new ApiError("unauthenticated", "unauthenticated");
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchJwks(
	url: string,
	fetchImpl: FetchImpl,
	now: number,
	force: boolean,
): Promise<Jwk[]> {
	if (!force && jwksCache && jwksCache.url === url && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
		return jwksCache.keys;
	}
	let res: Response;
	try {
		res = await fetchImpl(url);
	} catch {
		throw unauthenticated();
	}
	if (!res.ok) {
		throw unauthenticated();
	}
	let body: { keys?: Jwk[] };
	try {
		body = (await res.json()) as { keys?: Jwk[] };
	} catch {
		throw unauthenticated();
	}
	const keys = Array.isArray(body.keys) ? body.keys : [];
	jwksCache = { url, fetchedAt: now, keys };
	return keys;
}

async function verifyJwt(
	token: string,
	jwk: Jwk,
	iss: string,
	aud: string,
	nowSec: number,
): Promise<string> {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
		throw unauthenticated();
	}
	let header: { alg?: string; kid?: string };
	let payload: {
		iss?: string;
		aud?: string | string[];
		exp?: number;
		nbf?: number;
		email?: string;
	};
	try {
		header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as typeof header;
		payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as typeof payload;
	} catch {
		throw unauthenticated();
	}
	if (header.alg !== "RS256") {
		throw unauthenticated();
	}
	let ok = false;
	try {
		const key = await crypto.subtle.importKey(
			"jwk",
			jwk,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["verify"],
		);
		ok = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			b64urlToBytes(parts[2]),
			new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
		);
	} catch {
		throw unauthenticated();
	}
	if (!ok) {
		throw unauthenticated();
	}
	if (payload.iss !== iss) {
		throw unauthenticated();
	}
	const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
	if (!audOk) {
		throw unauthenticated();
	}
	if (typeof payload.exp !== "number" || payload.exp + SKEW_SEC <= nowSec) {
		throw unauthenticated();
	}
	if (
		payload.nbf !== undefined &&
		(typeof payload.nbf !== "number" || payload.nbf - SKEW_SEC > nowSec)
	) {
		throw unauthenticated();
	}
	if (typeof payload.email !== "string" || payload.email.length === 0) {
		throw unauthenticated();
	}
	return payload.email;
}

type AccessConfig = { iss: string; aud: string; jwksUrl: string };

function accessConfig(env: Env): AccessConfig {
	const mode = resourceEnv(env.RESOURCE_ENV);
	if (mode === "test") {
		if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || !env.ACCESS_JWKS_URL) {
			throw new ApiError("internal", "internal error");
		}
		return {
			iss: env.CF_ACCESS_TEAM_DOMAIN,
			aud: env.CF_ACCESS_AUD,
			jwksUrl: env.ACCESS_JWKS_URL,
		};
	}
	const iss = ACCESS_TEAM_DOMAIN;
	return { iss, aud: ACCESS_AUD, jwksUrl: `${iss.replace(/\/$/, "")}/cdn-cgi/access/certs` };
}

export async function resolveAccessIdentity(
	request: Request,
	env: Env,
	fetchImpl: FetchImpl = fetch,
	nowMs: () => number = Date.now,
): Promise<{ email: string }> {
	const mode = resourceEnv(env.RESOURCE_ENV);
	const bypass = env.ACCESS_DEV_BYPASS_EMAIL?.trim() ?? "";
	if (mode === "development" && bypass.length > 0 && isDevBypassHost(request)) {
		return { email: bypass };
	}
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) {
		throw unauthenticated();
	}
	const cfg = accessConfig(env);
	const now = nowMs();
	const headerPart = token.split(".")[0];
	let kid: string | undefined;
	if (headerPart) {
		try {
			const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerPart))) as {
				kid?: string;
			};
			kid = header.kid;
		} catch {
			throw unauthenticated();
		}
	}
	if (!kid) {
		throw unauthenticated();
	}
	let keys = await fetchJwks(cfg.jwksUrl, fetchImpl, now, false);
	let jwk = keys.find((key) => key.kid === kid);
	if (!jwk) {
		keys = await fetchJwks(cfg.jwksUrl, fetchImpl, now, true);
		jwk = keys.find((key) => key.kid === kid);
	}
	if (!jwk) {
		throw unauthenticated();
	}
	const email = await verifyJwt(token, jwk, cfg.iss, cfg.aud, Math.floor(now / 1000));
	return { email };
}

export async function accessMiddleware(
	c: Context<{ Bindings: Env; Variables: { adminEmail: string } }>,
	next: Next,
): Promise<void> {
	const identity = await resolveAccessIdentity(c.req.raw, c.env);
	c.set("adminEmail", identity.email);
	await next();
}
