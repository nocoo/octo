import { d1Results } from "../../lib/d1";
import {
	capVectorTopK,
	type VectorQueryHit,
	type VectorQueryInput,
	type VectorStore,
} from "./types";

export class CloudflareVectorStore implements VectorStore {
	constructor(private readonly index: Vectorize) {}

	async query(input: VectorQueryInput): Promise<VectorQueryHit[]> {
		const topK = capVectorTopK(input.topK, input.returnMetadata);
		const options: VectorizeQueryOptions = {
			topK,
			returnMetadata: input.returnMetadata,
		};
		if (input.filter) {
			options.filter = input.filter;
		}
		const result = await this.index.query(input.vector, options);
		return d1Results({ results: result.matches }).map((match) => ({
			id: match.id,
			score: match.score ?? 0,
		}));
	}
}
