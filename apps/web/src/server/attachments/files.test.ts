import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/errors";
import { streamSignedFile } from "./files";
import { signAttachmentUrl } from "./url-sign";

describe("streamSignedFile", () => {
	const blobs = {
		get: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	};

	it("returns not found when object missing", async () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		const sig = await signAttachmentUrl("secret", "att/m/a", exp);
		blobs.get.mockResolvedValue(null);
		await expect(
			streamSignedFile({ blobs, urlSecret: "secret" }, "att/m/a", String(exp), sig),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("rejects expired signatures", async () => {
		const exp = Math.floor(Date.now() / 1000) - 5;
		const sig = await signAttachmentUrl("secret", "att/m/a", exp);
		await expect(
			streamSignedFile(
				{ blobs, urlSecret: "secret", nowSeconds: () => Math.floor(Date.now() / 1000) },
				"att/m/a",
				String(exp),
				sig,
			),
		).rejects.toMatchObject({ code: "unauthenticated" });
	});

	it("rejects invalid exp", async () => {
		await expect(
			streamSignedFile({ blobs, urlSecret: "s" }, "att/m/a", "nope", "sig"),
		).rejects.toBeInstanceOf(ApiError);
	});

	it("rejects bad signatures", async () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		await expect(
			streamSignedFile({ blobs, urlSecret: "secret" }, "att/m/a", String(exp), "00".repeat(32)),
		).rejects.toMatchObject({ code: "unauthenticated" });
	});

	it("rejects missing query params", async () => {
		await expect(
			streamSignedFile({ blobs, urlSecret: "s" }, "att/m/a", undefined, undefined),
		).rejects.toBeInstanceOf(ApiError);
	});

	it("streams when signature is valid", async () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		const sig = await signAttachmentUrl("secret", "att/m/a", exp);
		blobs.get.mockResolvedValue({
			body: new ReadableStream(),
			contentType: "image/png",
			sha256: "abc",
			size: 1,
		});
		const res = await streamSignedFile(
			{ blobs, urlSecret: "secret", nowSeconds: () => Math.floor(Date.now() / 1000) },
			"att/m/a",
			String(exp),
			sig,
			"x.png",
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("etag")).toBe('"abc"');
		expect(res.headers.get("content-disposition")).toContain("x.png");
	});
});
