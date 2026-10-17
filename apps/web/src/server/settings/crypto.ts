import { ApiError } from "../lib/errors";

export type EncryptedApiKey = {
	ciphertext: Uint8Array<ArrayBuffer>;
	iv: Uint8Array<ArrayBuffer>;
	key_version: number;
};

const AAD = new TextEncoder().encode("octo:embedding.api_key:1");

export function settingsUnavailable(): ApiError {
	return new ApiError("unavailable", "embedding settings unavailable");
}

async function masterKey(secret: string | undefined): Promise<CryptoKey> {
	if (!secret) throw settingsUnavailable();
	const binary = atob(secret);
	if (binary.length !== 32 || btoa(binary) !== secret) throw settingsUnavailable();
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptApiKey(
	secret: string | undefined,
	plaintext: string,
): Promise<EncryptedApiKey> {
	try {
		const key = await masterKey(secret);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: AAD },
			key,
			new TextEncoder().encode(plaintext),
		);
		return { ciphertext: new Uint8Array(ciphertext), iv, key_version: 1 };
	} catch {
		throw settingsUnavailable();
	}
}

export async function decryptApiKey(
	secret: string | undefined,
	value: EncryptedApiKey,
): Promise<string> {
	try {
		if (value.key_version !== 1 || value.iv.byteLength !== 12) throw settingsUnavailable();
		const key = await masterKey(secret);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: value.iv, additionalData: AAD },
			key,
			value.ciphertext,
		);
		return new TextDecoder().decode(plaintext);
	} catch {
		throw settingsUnavailable();
	}
}
