import { describe, expect, it, vi } from "vitest";
import { createR2BlobStore, r2ObjectToBlobObject } from "./blob-r2";

function minimalR2Body(): R2ObjectBody {
	return {
		body: new ReadableStream(),
		size: 0,
		customMetadata: { content_type: "image/gif" },
		httpMetadata: {},
		arrayBuffer: async () => new ArrayBuffer(0),
		bytes: async () => new Uint8Array(),
		text: async () => "",
		json: async () => ({}),
		blob: async () => new Blob(),
		bodyUsed: false,
		writeHttpMetadata: () => {},
	} as unknown as R2ObjectBody;
}

describe("R2 blob store", () => {
	it("puts with metadata", async () => {
		const put = vi.fn();
		const bucket = { put, get: vi.fn(), delete: vi.fn() } as unknown as R2Bucket;
		const store = createR2BlobStore(bucket);
		await store.put("k", new Uint8Array([1]), {
			contentType: "image/png",
			sha256: "abc",
		});
		expect(put).toHaveBeenCalledWith(
			"k",
			new Uint8Array([1]),
			expect.objectContaining({
				customMetadata: { sha256: "abc", content_type: "image/png" },
			}),
		);
	});

	it("maps R2 objects", () => {
		const obj = {
			body: new ReadableStream(),
			size: 3,
			customMetadata: { sha256: "h", content_type: "image/png" },
			httpMetadata: { contentType: "image/png" },
		} as unknown as R2ObjectBody;
		expect(r2ObjectToBlobObject(obj).sha256).toBe("h");
		expect(r2ObjectToBlobObject(minimalR2Body()).contentType).toBe("image/gif");
		expect(
			r2ObjectToBlobObject({
				...minimalR2Body(),
				customMetadata: {},
				httpMetadata: {},
			} as R2ObjectBody).contentType,
		).toBe("application/octet-stream");
	});

	it("uses empty body when r2 returns none", async () => {
		const bucket = {
			put: vi.fn(),
			get: vi.fn().mockResolvedValue({
				body: null,
				size: 0,
				customMetadata: { sha256: "h", content_type: "image/png" },
				httpMetadata: { contentType: "image/png" },
			}),
			delete: vi.fn(),
		} as unknown as R2Bucket;
		const obj = await createR2BlobStore(bucket).get("k");
		expect(obj?.body).toBeInstanceOf(ReadableStream);
	});

	it("deletes objects", async () => {
		const del = vi.fn();
		const bucket = {
			put: vi.fn(),
			get: vi.fn(),
			delete: del,
		} as unknown as R2Bucket;
		await createR2BlobStore(bucket).delete("k");
		expect(del).toHaveBeenCalledWith("k");
	});

	it("falls back to http metadata", async () => {
		const bucket = {
			put: vi.fn(),
			get: vi.fn().mockResolvedValue({
				body: new ReadableStream(),
				size: 1,
				customMetadata: {},
				httpMetadata: { contentType: "application/pdf" },
			}),
			delete: vi.fn(),
		} as unknown as R2Bucket;
		const obj = await createR2BlobStore(bucket).get("k");
		expect(obj?.contentType).toBe("application/pdf");
		expect(obj?.sha256).toBe("");
	});

	it("returns null when missing", async () => {
		const bucket = {
			put: vi.fn(),
			get: vi.fn().mockResolvedValue(null),
			delete: vi.fn(),
		} as unknown as R2Bucket;
		expect(await createR2BlobStore(bucket).get("x")).toBeNull();
	});
});
