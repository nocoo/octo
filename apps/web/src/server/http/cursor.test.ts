import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { cursorSecretFromEnv, decodeCursor, encodeCursor } from "./cursor";

const secret = "test-pepper";

describe("cursor codec", () => {
	it("encodes and decodes memory list cursors", async () => {
		const payload = { u: 1_700_000_000_000, i: "01JABCDEF" };
		const cursor = await encodeCursor(secret, payload);
		expect(cursor).not.toContain("+");
		expect(cursor).not.toContain("/");
		expect(await decodeCursor(secret, cursor)).toEqual(payload);
	});

	it("encodes and decodes change seq cursors", async () => {
		const payload = { s: 42 };
		const cursor = await encodeCursor(secret, payload);
		expect(await decodeCursor(secret, cursor)).toEqual(payload);
	});

	it("rejects tampered cursors", async () => {
		const cursor = await encodeCursor(secret, { s: 1 });
		const tampered = `${cursor.slice(0, -2)}xx`;
		await expect(decodeCursor(secret, tampered)).rejects.toBeInstanceOf(ApiError);
		await expect(decodeCursor(secret, tampered)).rejects.toMatchObject({
			code: "validation_failed",
		});
	});

	it("rejects cursors with the wrong version", async () => {
		const { base64UrlEncode } = await import("./base64url");
		const blob = base64UrlEncode(
			new TextEncoder().encode(JSON.stringify({ v: 9, p: "x", m: "y" })),
		);
		await expect(decodeCursor(secret, blob)).rejects.toMatchObject({
			code: "validation_failed",
		});
	});

	it.each(["null", "1", "true", '"text"', "[]", "{}", '{"v":1}'])(
		"rejects decoded %s",
		async (json) => {
			const { base64UrlEncode } = await import("./base64url");
			await expect(
				decodeCursor(secret, base64UrlEncode(new TextEncoder().encode(json))),
			).rejects.toMatchObject({ code: "validation_failed" });
		},
	);

	it("rejects malformed cursors", async () => {
		await expect(decodeCursor(secret, "not-a-cursor")).rejects.toMatchObject({
			code: "validation_failed",
		});
	});

	it("requires API_KEY_PEPPER for cursor secrets", () => {
		expect(() => cursorSecretFromEnv({})).toThrow(ApiError);
		expect(cursorSecretFromEnv({ API_KEY_PEPPER: "pepper" })).toBe("pepper");
	});

	it("rejects array payloads", async () => {
		const { base64UrlEncode } = await import("./base64url");
		const { hmacSha256Base64Url } = await import("./crypto");
		const p = base64UrlEncode(new TextEncoder().encode("[]"));
		const m = await hmacSha256Base64Url(secret, `1:${p}`);
		const blob = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ v: 1, p, m })));
		await expect(decodeCursor(secret, blob)).rejects.toMatchObject({
			code: "validation_failed",
		});
	});
});
