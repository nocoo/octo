import { resourceEnv } from "../env";
import { ApiError } from "../lib/errors";

function publicHost(host: string): boolean {
	if (host.startsWith("[")) {
		return /^\[[23][0-9a-f]{3}:/.test(host) && !host.startsWith("[2002:");
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		const [a = 0, b = 0] = host.split(".").map(Number);
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && (b === 168 || b === 0)) ||
			(a === 198 && (b === 18 || b === 19))
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
			[...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
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
