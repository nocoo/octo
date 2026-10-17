export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
	const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
	const digest = await crypto.subtle.digest("SHA-256", buf);
	return bytesToHex(digest);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return bytesToHex(sig);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
