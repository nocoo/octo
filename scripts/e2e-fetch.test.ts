import { Readable } from "node:stream";
import { request } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { e2eFetch } from "./e2e-fetch";

vi.mock("undici", async (importOriginal) => ({
	...(await importOriginal<typeof import("undici")>()),
	request: vi.fn(),
}));

function response(statusCode: number, contents = "failure") {
	return {
		statusCode,
		headers: {
			"content-type": "text/plain",
			"x-test": ["first", "second"],
			"x-missing": undefined,
		},
		body: Readable.from([Buffer.from(contents)]),
	} as unknown as Awaited<ReturnType<typeof request>>;
}

afterEach(() => {
	vi.resetAllMocks();
	vi.unstubAllGlobals();
});

describe("L2 HTTP response ownership", () => {
	it("preserves a delivered early error and the complete declared upload without retrying", async () => {
		const body = new Uint8Array(50 * 1024 * 1024 + 1);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("wrong transport")),
		);
		vi.mocked(request).mockResolvedValue(response(413));
		const result = await e2eFetch("http://127.0.0.1:9/upload", {
			method: "POST",
			headers: { "Content-Type": "image/png" },
			body,
		});
		expect(result.status).toBe(413);
		expect(await result.text()).toBe("failure");
		expect(result.headers.get("x-test")).toBe("first, second");
		expect(request).toHaveBeenCalledOnce();
		const call = vi.mocked(request).mock.calls[0];
		expect(call?.[0]).toBe("http://127.0.0.1:9/upload");
		expect(call?.[1]?.body).toBe(body);
		expect(call?.[1]?.method).toBe("POST");
		expect(call?.[1]?.headers).toEqual({ "content-type": "image/png", connection: "close" });
		expect(call?.[1]?.signal).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("preserves encoded multipart bodies and abort signals", async () => {
		const body = new FormData();
		const file = new File(["contents"], "file.png", { type: "image/png" });
		body.set("file", file);
		body.append("note", "first");
		body.append("note", "second");
		const controller = new AbortController();
		vi.mocked(request).mockResolvedValue(response(500));
		expect(
			(
				await e2eFetch("http://127.0.0.1:9/upload", {
					method: "POST",
					body,
					signal: controller.signal,
				})
			).status,
		).toBe(500);
		expect(request).toHaveBeenCalledOnce();
		const options = vi.mocked(request).mock.calls[0]?.[1];
		expect(options?.signal).toBe(controller.signal);
		expect(options?.body).toBeInstanceOf(Uint8Array);
		const requestHeaders = options?.headers as
			| Record<string, string | string[] | undefined>
			| undefined;
		expect(requestHeaders?.["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
	});

	it("streams chunked request and response bytes without buffering the upload", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				controller.close();
			},
		});
		vi.mocked(request).mockImplementation(async (_url, options) => {
			expect(options?.body).toBeInstanceOf(Readable);
			const chunks: Uint8Array[] = [];
			if (!options?.body) throw new Error("expected a request body");
			for await (const chunk of options.body as Readable) chunks.push(chunk);
			expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2]));
			return response(200, "streamed");
		});
		expect(
			await (await e2eFetch("http://127.0.0.1:9/upload", { method: "POST", body })).text(),
		).toBe("streamed");
	});

	it.each([204, 205, 304])("preserves bodyless HTTP %s responses", async (statusCode) => {
		vi.mocked(request).mockResolvedValue(response(statusCode, ""));
		const result = await e2eFetch("http://127.0.0.1:9/upload");
		expect(result.status).toBe(statusCode);
		expect(result.body).toBeNull();
	});

	it.each(["GET", "POST"])(
		"propagates failed %s requests without retries or leaking queries/auth",
		async (method) => {
			const cause = new Error("write EPIPE");
			vi.mocked(request).mockRejectedValue(cause);
			const url = new URL("http://127.0.0.1:9/files/att/m/a?sig=private&exp=1");
			await expect(
				e2eFetch(url, {
					...(method === "GET" ? {} : { method }),
					headers: { Authorization: "Bearer private" },
				}),
			).rejects.toMatchObject({
				message: `L2 request failed: ${method} http://127.0.0.1:9/files/att/m/a`,
				cause,
			});
			expect(request).toHaveBeenCalledOnce();
		},
	);
});
