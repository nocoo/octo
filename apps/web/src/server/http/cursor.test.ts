import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { decodeCursor, encodeCursor } from "./cursor";

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
		const parts = cursor.split(".");
		const tampered = `${parts[0]}.${parts[1]}?.${parts[2]}`;
		await expect(decodeCursor(secret, tampered)).rejects.toBeInstanceOf(ApiError);
		await expect(decodeCursor(secret, tampered)).rejects.toMatchObject({
			code: "validation_failed",
		});
	});

	it("rejects malformed cursors", async () => {
		await expect(decodeCursor(secret, "not-a-cursor")).rejects.toMatchObject({
			code: "validation_failed",
		});
	});

	it("rejects array payloads", async () => {
		const { base64UrlEncode } = await import("./base64url");
		const { hmacSha256Base64Url } = await import("./crypto");
		const body = base64UrlEncode(new TextEncoder().encode("[]"));
		const mac = await hmacSha256Base64Url(secret, `c1:${body}`);
		await expect(decodeCursor(secret, `c1.${body}.${mac}`)).rejects.toMatchObject({
			code: "validation_failed",
		});
	});
});
