import { d1Results } from "../../lib/d1";
import { ApiError } from "../../lib/errors";
import {
	capVectorTopK,
	type VectorQueryHit,
	type VectorQueryInput,
	type VectorStore,
} from "./types";

const FILTER_BYTES_LIMIT = 2048;
const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
	return encoder.encode(JSON.stringify(value)).length;
}

function partitionFilter(filter: VectorizeVectorMetadataFilter): VectorizeVectorMetadataFilter[] {
	if (jsonBytes(filter) < FILTER_BYTES_LIMIT) return [filter];
	const splittable = Object.entries(filter)
		.filter((entry): entry is [string, { $in: (string | number | boolean)[] }] => {
			const expression = entry[1];
			return (
				typeof expression === "object" &&
				expression !== null &&
				"$in" in expression &&
				Array.isArray(expression.$in) &&
				expression.$in.length > 1
			);
		})
		.sort((a, b) => jsonBytes(b[1].$in) - jsonBytes(a[1].$in));
	const largest = splittable[0];
	if (!largest) throw new ApiError("unavailable", "vector metadata filter exceeds byte limit");
	const [field, expression] = largest;
	const middle = Math.ceil(expression.$in.length / 2);
	return [expression.$in.slice(0, middle), expression.$in.slice(middle)].flatMap(($in) =>
		partitionFilter({ ...filter, [field]: { ...expression, $in } }),
	);
}

export class CloudflareVectorStore implements VectorStore {
	constructor(private readonly index: Vectorize) {}

	async query(input: VectorQueryInput): Promise<VectorQueryHit[]> {
		const topK = capVectorTopK(input.topK, input.returnMetadata);
		const filters = input.filter ? partitionFilter(input.filter) : [undefined];
		const hits = new Map<string, VectorQueryHit>();
		for (const filter of filters) {
			const options: VectorizeQueryOptions = { topK, returnMetadata: input.returnMetadata };
			if (filter) options.filter = filter;
			const result = await this.index.query(input.vector, options);
			for (const match of d1Results({ results: result.matches })) {
				const score = match.score ?? 0;
				if (!hits.has(match.id) || score > (hits.get(match.id) as VectorQueryHit).score) {
					hits.set(match.id, { id: match.id, score });
				}
			}
		}
		return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, topK);
	}
}
