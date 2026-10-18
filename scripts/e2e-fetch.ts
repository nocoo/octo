import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { type Dispatcher, request } from "undici";

async function dispatch(
	url: string | URL,
	method: Dispatcher.HttpMethod,
	headers: Record<string, string>,
	body: Exclude<Dispatcher.DispatchOptions["body"], undefined> | null,
	signal: AbortSignal | null | undefined,
): Promise<Response> {
	headers.connection = "close";
	const result = await request(url, {
		method,
		headers,
		body: (body ?? null) as Exclude<Dispatcher.DispatchOptions["body"], undefined>,
		signal: signal ?? null,
	});
	const responseHeaders = new Headers();
	for (const [name, value] of Object.entries(result.headers)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
	}
	const bodyless = method === "HEAD" || [204, 205, 304].includes(result.statusCode);
	if (bodyless) result.body.resume();
	return new Response(
		bodyless ? null : (Readable.toWeb(result.body) as unknown as ReadableStream),
		{
			status: result.statusCode,
			headers: responseHeaders,
		},
	);
}

export async function e2eFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	try {
		const method = (init?.method ?? "GET") as Dispatcher.HttpMethod;
		if (init?.body instanceof FormData) {
			const encoded = new Request(url, {
				method,
				headers: init.headers,
				body: init.body,
				signal: init.signal,
				duplex: "half",
			} as RequestInit);
			const headers = Object.fromEntries(encoded.headers);
			const body = new Uint8Array(await encoded.arrayBuffer());
			return await dispatch(url, method, headers, body, init.signal);
		}
		const upload =
			init?.body instanceof ReadableStream
				? Readable.fromWeb(init.body as unknown as NodeReadableStream<Uint8Array>)
				: init?.body;
		const headers = Object.fromEntries(new Headers(init?.headers));
		return await dispatch(url, method, headers, (upload ?? null) as Dispatcher.DispatchOptions["body"], init?.signal);
	} catch (cause) {
		const { origin, pathname } = new URL(url);
		throw new Error(`L2 request failed: ${init?.method ?? "GET"} ${origin}${pathname}`, { cause });
	}
}
