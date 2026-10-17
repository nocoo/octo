import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/errors";
import { MAX_ATTACHMENT_BYTES } from "./content-type";
import { parseAttachmentUpload, parseMultipartUpload, parseRawUpload } from "./upload";

describe("attachment upload parsing", () => {
	it("parses raw uploads", async () => {
		const body = new Uint8Array([1, 2, 3]);
		const req = new Request("http://x", {
			method: "POST",
			headers: {
				"Content-Type": "image/png",
				"X-Filename": "a.png",
			},
			body,
		});
		const parsed = await parseRawUpload(req);
		expect(parsed.filename).toBe("a.png");
		expect(parsed.contentType).toBe("image/png");
		expect(parsed.bytes).toEqual(body);
	});

	it("defaults multipart type when missing", async () => {
		const form = new FormData();
		form.append("file", new File([new Uint8Array([1])], "b.bin", { type: "" }));
		const req = new Request("http://x", { method: "POST", body: form });
		await expect(parseMultipartUpload(req)).rejects.toMatchObject({
			code: "unsupported_media_type",
		});
	});

	it("parses multipart uploads", async () => {
		const form = new FormData();
		form.append("file", new File([new Uint8Array([9])], "b.pdf", { type: "application/pdf" }));
		const req = new Request("http://x", { method: "POST", body: form });
		const parsed = await parseMultipartUpload(req);
		expect(parsed.filename).toBe("b.pdf");
		expect(parsed.contentType).toBe("application/pdf");
	});

	it("rejects oversize and bad types", async () => {
		const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
		await expect(
			parseRawUpload(
				new Request("http://x", {
					method: "POST",
					headers: { "Content-Type": "image/png", "X-Filename": "a.png" },
					body: big,
				}),
			),
		).rejects.toBeInstanceOf(ApiError);
		await expect(
			parseRawUpload(
				new Request("http://x", {
					method: "POST",
					headers: { "Content-Type": "text/plain", "X-Filename": "a.txt" },
					body: new Uint8Array([1]),
				}),
			),
		).rejects.toMatchObject({ code: "unsupported_media_type" });
	});

	it("accepts a 50 mib multipart file plus its envelope", async () => {
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(MAX_ATTACHMENT_BYTES)], "max.pdf", {
				type: "application/pdf",
			}),
		);
		const parsed = await parseMultipartUpload(
			new Request("http://x", { method: "POST", body: form }),
		);
		expect(parsed.bytes.byteLength).toBe(MAX_ATTACHMENT_BYTES);
	});

	it.each(["extra", "duplicate"])("rejects multipart %s parts", async (part) => {
		const form = new FormData();
		form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
		form.append(part === "duplicate" ? "file" : "note", "unexpected");
		await expect(
			parseMultipartUpload(new Request("http://x", { method: "POST", body: form })),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("rejects multipart file bytes over 50 mib", async () => {
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.pdf", {
				type: "application/pdf",
			}),
		);
		await expect(
			parseMultipartUpload(new Request("http://x", { method: "POST", body: form })),
		).rejects.toMatchObject({ code: "payload_too_large" });
	});

	it("rejects excessive multipart envelope bytes", async () => {
		const form = new FormData();
		form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
		const encoded = new Request("http://x", { method: "POST", body: form });
		const bytes = new Uint8Array(await encoded.arrayBuffer());
		const padded = new Uint8Array(bytes.length + 64 * 1024);
		padded.set(bytes);
		await expect(
			parseMultipartUpload(
				new Request("http://x", {
					method: "POST",
					headers: encoded.headers,
					body: padded,
				}),
			),
		).rejects.toMatchObject({ code: "payload_too_large" });
	});

	it("rejects malformed multipart bodies", async () => {
		await expect(
			parseMultipartUpload(
				new Request("http://x", {
					method: "POST",
					headers: { "Content-Type": "multipart/form-data; boundary=missing" },
					body: "broken",
				}),
			),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("releases oversized multipart bodies to the runtime without parsing", async () => {
		const cancel = vi.fn();
		let reads = 0;
		const formData = vi.spyOn(Request.prototype, "formData");
		const chunk = new Uint8Array(1024 * 1024);
		const req = new Request("http://x", {
			method: "POST",
			headers: { "Content-Type": "multipart/form-data; boundary=x" },
			body: new ReadableStream(
				{
					pull(controller) {
						if (++reads > 51) throw new Error("unexpected multipart pull");
						controller.enqueue(chunk);
					},
					cancel,
				},
				{ highWaterMark: 0 },
			),
			duplex: "half",
		} as RequestInit);
		await expect(parseMultipartUpload(req)).rejects.toMatchObject({ code: "payload_too_large" });
		expect(reads).toBe(51);
		expect(req.body?.locked).toBe(false);
		expect(cancel).not.toHaveBeenCalled();
		expect(formData).not.toHaveBeenCalled();
		formData.mockRestore();
	});

	it("requires filename", async () => {
		await expect(
			parseRawUpload(
				new Request("http://x", {
					method: "POST",
					headers: { "Content-Type": "image/png" },
					body: new Uint8Array([1]),
				}),
			),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("requires multipart file field", async () => {
		const form = new FormData();
		const req = new Request("http://x", { method: "POST", body: form });
		await expect(parseMultipartUpload(req)).rejects.toMatchObject({
			code: "validation_failed",
		});
	});

	it("dispatches by content type", async () => {
		const form = new FormData();
		form.append("file", new File([new Uint8Array([1])], "c.gif", { type: "image/gif" }));
		const parsed = await parseAttachmentUpload(
			new Request("http://x", { method: "POST", body: form }),
		);
		expect(parsed.contentType).toBe("image/gif");
	});
});
