import { d1Results } from "../../lib/d1";
import { ApiError } from "../../lib/errors";
import {
	capVectorTopK,
	type VectorQueryHit,
	type VectorQueryInput,
	type VectorStore,
} from "./types";

const FILTER_BYTES_LIMIT = 2048;
const FILTER_QUERY_LIMIT = 64;
const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
	return encoder.encode(JSON.stringify(value)).length;
}

function partitionFilter(filter: VectorizeVectorMetadataFilter): VectorizeVectorMetadataFilter[] {
	let plannedQueries = 1;
	function visit(current: VectorizeVectorMetadataFilter): VectorizeVectorMetadataFilter[] {
		if (jsonBytes(current) < FILTER_BYTES_LIMIT) return [current];
		const splittable = Object.entries(current)
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
		if (plannedQueries === FILTER_QUERY_LIMIT) {
			throw new ApiError("unavailable", "vector metadata filter exceeds query budget");
		}
		plannedQueries++;
		const [field, expression] = largest;
		const middle = Math.ceil(expression.$in.length / 2);
		return [expression.$in.slice(0, middle), expression.$in.slice(middle)].flatMap(($in) =>
			visit({ ...current, [field]: { ...expression, $in } }),
		);
	}
	return visit(filter);
}

export class CloudflareVectorStore implements VectorStore {
	constructor(private readonly index: Vectorize) {}

	async upsert(records: VectorizeVector[]): Promise<void> {
		await this.index.upsert(records);
	}

	async delete(ids: string[]): Promise<void> {
		await this.index.deleteByIds(ids);
	}

	async query(input: VectorQueryInput): Promise<VectorQueryHit[]> {
		const topK = capVectorTopK(input.topK, input.returnMetadata);
		const filters = input.filter ? partitionFilter(input.filter) : [undefined];
		const hits = new Map<string, VectorQueryHit>();
		for (const filter of filters) {
			const options: VectorizeQueryOptions = {
				topK,
				returnMetadata: input.returnMetadata ? "all" : "none",
			};
			if (filter) options.filter = filter;
			const result = await this.index.query(input.vector, options);
			for (const match of d1Results({ results: result.matches })) {
				const score = match.score ?? 0;
				if (!hits.has(match.id) || score > (hits.get(match.id) as VectorQueryHit).score) {
					const generation = match.metadata?.generation;
					const contentHash = match.metadata?.content_hash;
					hits.set(match.id, {
						id: match.id,
						score,
						...(typeof generation === "number" && Number.isSafeInteger(generation)
							? { generation }
							: {}),
						...(typeof contentHash === "string" ? { content_hash: contentHash } : {}),
					});
				}
			}
		}
		return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, topK);
	}
}
