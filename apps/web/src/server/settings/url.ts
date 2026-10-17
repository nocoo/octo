import { resourceEnv } from "../env";
import { ApiError } from "../lib/errors";

function publicHost(host: string): boolean {
	if (host.startsWith("[")) {
		return /^\[[23][0-9a-f]{3}:/.test(host) && !host.startsWith("[2002:");
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		const [firstOctet = 0, secondOctet = 0] = host.split(".").map(Number);
		return !(
			firstOctet === 0 ||
			firstOctet === 10 ||
			firstOctet === 127 ||
			firstOctet >= 224 ||
			(firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127) ||
			(firstOctet === 169 && secondOctet === 254) ||
			(firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
			(firstOctet === 192 && (secondOctet === 168 || secondOctet === 0)) ||
			(firstOctet === 198 && (secondOctet === 18 || secondOctet === 19))
		);
	}
	return (
		host.includes(".") &&
		!/(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$|\.home\.arpa$/.test(host)
	);
}

export function validateEmbeddingUrl(value: string, mode: string | undefined): string {
	try {
		if (
			/[\s\\?#]/.test(value) ||
			[...value].some(
				(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
			)
		)
			throw new Error();
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
		const local = loopback && resourceEnv(mode) !== "production";
		if (
			url.username ||
			url.password ||
			(url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
			(!local && !publicHost(host))
		) {
			throw new Error();
		}
		return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
	} catch {
		throw new ApiError("validation_failed", "invalid embedding base URL");
	}
}
