const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const KEYID_LENGTH = 12;
export const SECRET_BYTES = 32;
export const SECRET_LENGTH = 52;
export const MAX_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			const index = (value >>> bits) & 31;
			out += BASE32.charAt(index);
		}
	}
	if (bits > 0) {
		const index = (value << (5 - bits)) & 31;
		out += BASE32.charAt(index);
	}
	return out;
}

export function generateApiKeyMaterial(): { keyid: string; secret: string; plaintext: string } {
	const keyidBytes = new Uint8Array(8);
	const secretBytes = new Uint8Array(SECRET_BYTES);
	crypto.getRandomValues(keyidBytes);
	crypto.getRandomValues(secretBytes);
	const keyid = encodeBase32(keyidBytes).slice(0, KEYID_LENGTH);
	const secret = encodeBase32(secretBytes);
	return { keyid, secret, plaintext: `octo_${keyid}_${secret}` };
}

const TOKEN_RE = /^octo_([A-Za-z2-7]{12})_([A-Za-z2-7]{52})$/;

export function parseApiKey(token: string): { keyid: string; secret: string } | null {
	const match = TOKEN_RE.exec(token);
	if (!match?.[1] || !match[2]) {
		return null;
	}
	return { keyid: match[1].toUpperCase(), secret: match[2].toUpperCase() };
}

export function timingSafeEqual(left: string, right: string): boolean {
	const a = new TextEncoder().encode(left);
	const b = new TextEncoder().encode(right);
	const n = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < n; i += 1) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}
	return diff === 0;
}

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

export async function hashSecret(pepper: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret));
	return hex(new Uint8Array(sig));
}

export async function secretsMatch(pepper: string, secret: string, hash: string): Promise<boolean> {
	return timingSafeEqual(await hashSecret(pepper, secret), hash);
}
