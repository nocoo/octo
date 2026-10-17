import { canonicalBody } from "./canonical-body";
import { sha256Hex } from "./crypto";

export async function requestHash(
	method: string,
	path: string,
	rawBody: string,
	ifMatch?: string,
): Promise<string> {
	const canonical = canonicalBody(rawBody);
	return sha256Hex(JSON.stringify([method.toUpperCase(), path, canonical, ifMatch ?? null]));
}
