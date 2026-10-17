import { describe, expect, it } from "vitest";
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
					headers: { "content-length": "2000000" },
					body: "{}",
				}),
			),
		).rejects.toMatchObject({ code: "payload_too_large" });
		await expect(
			readJsonLimited(new Request("http://x", { method: "POST", body: '{"a":1}' }), 3),
		).rejects.toMatchObject({ code: "payload_too_large" });
	});
});
