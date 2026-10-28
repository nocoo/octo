process.env.TZ = "UTC";

import { vi } from "vitest";

const realFetch = globalThis.fetch.bind(globalThis);

function denyNetwork(): Promise<Response> {
	throw new Error("network denied in L1");
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = requestUrl(input);
	if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
		return realFetch(input, init);
	}
	return denyNetwork();
});
