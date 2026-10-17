export type VectorQueryInput = {
	vector: number[];
	topK: number;
	filter?: VectorizeVectorMetadataFilter | undefined;
	returnMetadata: boolean;
};

export type VectorQueryHit = {
	id: string;
	score: number;
};

export interface VectorStore {
	query(input: VectorQueryInput): Promise<VectorQueryHit[]>;
}

export const VECTOR_TOPK_WITH_METADATA = 50;
export const VECTOR_TOPK_NO_METADATA = 100;

export function capVectorTopK(topK: number, returnMetadata: boolean): number {
	const max = returnMetadata ? VECTOR_TOPK_WITH_METADATA : VECTOR_TOPK_NO_METADATA;
	return Math.min(topK, max);
}
