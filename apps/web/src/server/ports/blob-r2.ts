import type { BlobObject, BlobStore } from "./blob";

export function createR2BlobStore(bucket: R2Bucket): BlobStore {
	return {
		async put(key, data, meta) {
			await bucket.put(key, data, {
				httpMetadata: { contentType: meta.contentType },
				customMetadata: {
					sha256: meta.sha256,
					content_type: meta.contentType,
				},
			});
		},
		async get(key) {
			const obj = await bucket.get(key);
			if (!obj) {
				return null;
			}
			const sha256 = obj.customMetadata?.sha256 ?? "";
			const contentType =
				obj.customMetadata?.content_type ??
				obj.httpMetadata?.contentType ??
				"application/octet-stream";
			return {
				body: obj.body ?? new ReadableStream(),
				contentType,
				sha256,
				size: obj.size,
			};
		},
		async delete(key) {
			await bucket.delete(key);
		},
	};
}

export function r2ObjectToBlobObject(obj: R2ObjectBody): BlobObject {
	const sha256 = obj.customMetadata?.sha256 ?? "";
	const contentType =
		obj.customMetadata?.content_type ?? obj.httpMetadata?.contentType ?? "application/octet-stream";
	return {
		body: obj.body,
		contentType,
		sha256,
		size: obj.size,
	};
}
