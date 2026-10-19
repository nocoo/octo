export type VectorQueryInput = {
	vector: number[];
	topK: number;
	filter?: VectorizeVectorMetadataFilter | undefined;
	returnMetadata: boolean;
};

export type VectorQueryHit = {
	id: string;
	score: number;
	generation?: number;
	content_hash?: string;
};

export interface VectorStore {
	query(input: VectorQueryInput): Promise<VectorQueryHit[]>;
	upsert(records: VectorizeVector[]): Promise<void>;
	delete(ids: string[]): Promise<void>;
}

export const VECTOR_TOPK_WITH_METADATA = 50;
export const VECTOR_TOPK_NO_METADATA = 100;

export function capVectorTopK(topK: number, returnMetadata: boolean): number {
	const max = returnMetadata ? VECTOR_TOPK_WITH_METADATA : VECTOR_TOPK_NO_METADATA;
	return Math.min(topK, max);
}
