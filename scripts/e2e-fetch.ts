import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { FormData as ClientFormData, type Dispatcher, request } from "undici";

function multipartBody(form: FormData): ClientFormData {
	const body = new ClientFormData();
	for (const [name, value] of form) body.append(name, value);
	return body;
}

export async function e2eFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	try {
		const method = (init?.method ?? "GET") as Dispatcher.HttpMethod;
		const upload =
			init?.body instanceof FormData
				? multipartBody(init.body)
				: init?.body instanceof ReadableStream
					? Readable.fromWeb(init.body as unknown as NodeReadableStream<Uint8Array>)
					: init?.body;
		const result = await request(url, {
			method,
			headers: Object.fromEntries(new Headers(init?.headers)),
			body: (upload ?? null) as Exclude<Dispatcher.DispatchOptions["body"], undefined>,
			signal: init?.signal ?? null,
		});
		const headers = new Headers();
		for (const [name, value] of Object.entries(result.headers)) {
			if (value === undefined) continue;
			for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
		}
		const bodyless = method === "HEAD" || [204, 205, 304].includes(result.statusCode);
		if (bodyless) result.body.resume();
		return new Response(
			bodyless ? null : (Readable.toWeb(result.body) as unknown as ReadableStream),
			{
				status: result.statusCode,
				headers,
			},
		);
	} catch (cause) {
		const { origin, pathname } = new URL(url);
		throw new Error(`L2 request failed: ${init?.method ?? "GET"} ${origin}${pathname}`, { cause });
	}
}
