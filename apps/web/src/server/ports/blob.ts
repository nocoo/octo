export type BlobPutMeta = {
	contentType: string;
	sha256: string;
};

export type BlobObject = {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	sha256: string;
	size: number;
};

export interface BlobStore {
	put(key: string, data: ArrayBuffer | Uint8Array, meta: BlobPutMeta): Promise<void>;
	get(key: string): Promise<BlobObject | null>;
	delete(key: string): Promise<void>;
}
