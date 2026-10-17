import { hmacSha256Hex, timingSafeEqualHex } from "./crypto";

export const DEFAULT_ATTACHMENT_URL_TTL_SECONDS = 300;

export function signPayload(r2Key: string, exp: number): string {
	return `${r2Key}|${exp}`;
}

export async function signAttachmentUrl(
	secret: string,
	r2Key: string,
	exp: number,
): Promise<string> {
	return hmacSha256Hex(secret, signPayload(r2Key, exp));
}

export async function verifyAttachmentUrlSig(
	secret: string,
	r2Key: string,
	exp: number,
	sig: string,
): Promise<boolean> {
	const expected = await signAttachmentUrl(secret, r2Key, exp);
	return timingSafeEqualHex(expected, sig.toLowerCase());
}

export function attachmentFilesPath(r2Key: string): string {
	return `/files/${r2Key}`;
}

export function buildSignedFileUrl(
	publicOrigin: string,
	r2Key: string,
	exp: number,
	sig: string,
): string {
	const base = publicOrigin.replace(/\/$/, "");
	return `${base}${attachmentFilesPath(r2Key)}?exp=${exp}&sig=${sig}`;
}

export function isExpired(exp: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
	return exp < nowSeconds;
}
