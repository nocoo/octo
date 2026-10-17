import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/errors";
import { readLimitedBody } from "./body-limit";

describe("readLimitedBody", () => {
	it("rejects declared length over the limit without reading the stream", async () => {
		const req = new Request("http://x", {
			method: "POST",
			headers: { "Content-Length": "100" },
			body: new Uint8Array(0),
		});
		await expect(readLimitedBody(req, 50)).rejects.toMatchObject({
			code: "payload_too_large",
		});
	});

	it("stops reading once the stream exceeds the limit", async () => {
		const req = new Request("http://x", {
			method: "POST",
			body: new Uint8Array(51),
			duplex: "half",
			headers: { "Content-Length": "51" },
		} as RequestInit);
		await expect(readLimitedBody(req, 50)).rejects.toBeInstanceOf(ApiError);
	});

	it.each([undefined, "1", "invalid"])(
		"cancels excess streams with declared length %s",
		async (length) => {
			const cancel = vi.fn();
			let reads = 0;
			const req = new Request("http://x", {
				method: "POST",
				headers: length ? { "Content-Length": length } : {},
				body: new ReadableStream(
					{
						pull(controller) {
							reads++;
							controller.enqueue(new Uint8Array(3));
						},
						cancel,
					},
					{ highWaterMark: 0 },
				),
				duplex: "half",
			} as RequestInit);
			await expect(readLimitedBody(req, 5)).rejects.toMatchObject({ code: "payload_too_large" });
			expect(cancel).toHaveBeenCalledOnce();
			expect(reads).toBe(2);
			expect(req.body?.locked).toBe(false);
		},
	);

	it("rejects declared oversize without acquiring or aborting the unused body", async () => {
		const pull = vi.fn();
		const cancel = vi.fn();
		const req = new Request("http://x", {
			method: "POST",
			headers: { "Content-Length": "6" },
			body: new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
			duplex: "half",
		} as RequestInit);
		const getReader = vi.spyOn(req.body as ReadableStream, "getReader");
		await expect(readLimitedBody(req, 5)).rejects.toMatchObject({ code: "payload_too_large" });
		expect(getReader).not.toHaveBeenCalled();
		expect(pull).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
		expect(req.bodyUsed).toBe(false);
		await req.body?.cancel();
	});

	it("accepts empty bodies and the exact limit", async () => {
		await expect(readLimitedBody(new Request("http://x"), 5)).resolves.toEqual(new Uint8Array());
		await expect(
			readLimitedBody(new Request("http://x", { method: "POST", body: new Uint8Array(5) }), 5),
		).resolves.toHaveLength(5);
	});

	it.each([true, false])(
		"preserves 413 when cancellation rejects (declared=%s)",
		async (declared) => {
			const req = new Request("http://x", {
				method: "POST",
				headers: declared ? { "Content-Length": "6" } : {},
				body: new ReadableStream(
					{
						pull(controller) {
							controller.enqueue(new Uint8Array(6));
						},
						cancel() {
							throw new Error("cancel failed");
						},
					},
					{ highWaterMark: 0 },
				),
				duplex: "half",
			} as RequestInit);
			await expect(readLimitedBody(req, 5)).rejects.toMatchObject({ code: "payload_too_large" });
		},
	);

	it("rejects declared oversize even without a body", async () => {
		await expect(
			readLimitedBody(
				new Request("http://x", {
					headers: { "Content-Length": "6" },
				}),
				5,
			),
		).rejects.toMatchObject({ code: "payload_too_large" });
	});

	it("returns the full body when within the limit", async () => {
		const payload = new Uint8Array([1, 2, 3]);
		const req = new Request("http://x", { method: "POST", body: payload });
		await expect(readLimitedBody(req, 10)).resolves.toEqual(payload);
	});
});
