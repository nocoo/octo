const KEY_RE = /^octo_([a-z2-7]{12})_([a-z2-7]+)$/i;

export type ParsedApiKey = {
	keyId: string;
	secret: string;
};

export function parseBearerToken(header: string | undefined): ParsedApiKey | null {
	if (!header?.startsWith("Bearer ")) {
		return null;
	}
	const token = header.slice("Bearer ".length).trim();
	const match = KEY_RE.exec(token);
	if (!match) {
		return null;
	}
	const keyId = match[1];
	const secret = match[2];
	if (!keyId || !secret) {
		return null;
	}
	return { keyId: keyId.toLowerCase(), secret: secret.toLowerCase() };
}

function bufferToHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSecretHash(pepper: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret));
	return bufferToHex(sig);
}

export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
