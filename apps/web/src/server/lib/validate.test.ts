import { describe, expect, it, vi } from "vitest";
import { memoryCreateSchema } from "../../lib/schema/memory";
import { ApiError } from "./errors";
import { parseStrict, readJson, readJsonLimited } from "./validate";

describe("parseStrict", () => {
	it("returns parsed data", () => {
		const body = {
			space: "kb-bot",
			title: "t",
			body: "b",
			type: "note" as const,
			tags: [],
		};
		expect(parseStrict(memoryCreateSchema, body)).toEqual(body);
	});

	it("throws validation_failed with issue paths", () => {
		try {
			parseStrict(memoryCreateSchema, { extra: true });
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			const api = err as ApiError;
			expect(api.code).toBe("validation_failed");
			expect(api.details).toMatchObject({ issues: expect.any(Array) });
		}
	});
});

describe("readJson", () => {
	it("parses json or throws validation_failed", async () => {
		expect(await readJson(new Request("http://x", { method: "POST", body: '{"a":1}' }))).toEqual({
			a: 1,
		});
		await expect(
			readJson(new Request("http://x", { method: "POST", body: "nope" })),
		).rejects.toBeInstanceOf(ApiError);
	});
});

describe("readJsonLimited", () => {
	it("cancels an oversized unknown-length stream before consuming the remainder", async () => {
		let reads = 0;
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					reads++;
					controller.enqueue(new Uint8Array(8));
					if (reads === 5) controller.close();
				},
				cancel,
			},
			{ highWaterMark: 0 },
		);
		const request = new Request("http://x", {
			method: "POST",
			body: stream,
			duplex: "half",
		} as RequestInit);
		await expect(readJsonLimited(request, 10)).rejects.toMatchObject({ code: "payload_too_large" });
		expect(reads).toBe(2);
		expect(cancel).toHaveBeenCalledOnce();
		await expect(
			readJsonLimited(new Request("http://x", { method: "POST" })),
		).rejects.toMatchObject({ code: "validation_failed" });
	});
	it("rejects oversized payloads and invalid json", async () => {
		expect(
			await readJsonLimited(new Request("http://x", { method: "POST", body: '{"ok":true}' })),
		).toEqual({ ok: true });
		await expect(
			readJsonLimited(new Request("http://x", { method: "POST", body: "nope" })),
		).rejects.toMatchObject({ code: "validation_failed" });
		await expect(
			readJsonLimited(
				new Request("http://x", {
					method: "POST",
					headers: { "content-length": "7000000" },
					body: "{}",
				}),
			),
		).rejects.toMatchObject({ code: "payload_too_large" });
		await expect(
			readJsonLimited(new Request("http://x", { method: "POST", body: '{"a":1}' }), 3),
		).rejects.toMatchObject({ code: "payload_too_large" });
	});
});
