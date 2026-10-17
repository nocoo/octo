import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { L2_JWKS_PORT } from "./ports";

export const L2_ACCESS_AUD = "octo-e2e";
export const L2_JWKS_KID = "e2e";

export type Jwk = {
	kty?: string;
	kid?: string;
	alg?: string;
	use?: string;
	n?: string;
	e?: string;
	d?: string;
	p?: string;
	q?: string;
	dp?: string;
	dq?: string;
	qi?: string;
};

export type JwksState = {
	kid: string;
	privateJwk: Jwk;
	publicJwk: Jwk;
};

export function l2AccessIss(port = L2_JWKS_PORT): string {
	return `http://127.0.0.1:${port}`;
}

export function l2JwksUrl(port = L2_JWKS_PORT): string {
	return `${l2AccessIss(port)}/cdn-cgi/access/certs`;
}

export function b64url(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) {
		s += String.fromCharCode(b);
	}
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
	const padded =
		value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
	const bin = atob(padded);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

export function tamperJwtSignature(jwt: string): string {
	const parts = jwt.split(".");
	const header = parts[0];
	const payload = parts[1];
	const sig = parts[2];
	if (parts.length !== 3 || !header || !payload || sig === undefined) {
		throw new Error("jwt must have three parts");
	}
	const bytes = b64urlDecode(sig);
	const original = bytes[0];
	if (original === undefined) {
		throw new Error("empty signature");
	}
	bytes[0] = original ^ 0xff;
	return `${header}.${payload}.${b64url(bytes)}`;
}

export async function generateJwksPair(kid = L2_JWKS_KID): Promise<JwksState> {
	const pair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as Jwk;
	const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
	publicJwk.kid = kid;
	publicJwk.alg = "RS256";
	publicJwk.use = "sig";
	return { kid, privateJwk, publicJwk };
}

export async function signAccessJwt(
	state: JwksState,
	payload: Record<string, unknown>,
	kid = state.kid,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"jwk",
		state.privateJwk as never,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
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

export async function loadJwksState(path = process.env.OCTO_JWKS_STATE): Promise<JwksState> {
	if (!path) {
		throw new Error("OCTO_JWKS_STATE is required");
	}
	return JSON.parse(await readFile(path, "utf8")) as JwksState;
}

export type JwksStub = { close: () => Promise<void>; url: string };

export function startJwksStub(port: number, state: JwksState): Promise<JwksStub> {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			if (req.url?.includes("/cdn-cgi/access/certs")) {
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ keys: [state.publicJwk] }));
				return;
			}
			res.statusCode = 404;
			res.end();
		});
		server.once("error", (err) => {
			const code =
				err && typeof err === "object" && "code" in err
					? String((err as { code: unknown }).code)
					: "";
			if (code === "EADDRINUSE") {
				reject(new Error(`port ${port} already in use`));
				return;
			}
			reject(err);
		});
		server.listen(port, "127.0.0.1", () => {
			resolve({
				url: l2JwksUrl(port),
				close: () =>
					new Promise((done) => {
						server.close(() => done());
					}),
			});
		});
	});
}
