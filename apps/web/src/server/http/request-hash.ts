import { canonicalBody } from "./canonical-body";
import { sha256Hex } from "./crypto";

export async function requestHash(method: string, path: string, rawBody: string): Promise<string> {
	const canonical = canonicalBody(rawBody);
	return sha256Hex(`${method.toUpperCase()}\n${path}\n${canonical}`);
}
