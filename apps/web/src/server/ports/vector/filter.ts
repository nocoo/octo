import type { MemoryFilters } from "../../../lib/schema/filters";
import { isoToMs } from "../../search/time";

export function buildVectorMetadataFilter(
	filters: MemoryFilters | undefined,
	spaceSlugs: string[],
): VectorizeVectorMetadataFilter | undefined {
	const parts: VectorizeVectorMetadataFilter[] = [];
	if (spaceSlugs.length > 0) {
		parts.push({ space: { $in: spaceSlugs } });
	}
	if (!filters) {
		if (parts.length === 0) {
			return undefined;
		}
		return parts.length === 1
			? (parts[0] as VectorizeVectorMetadataFilter)
			: ({ $and: parts } as VectorizeVectorMetadataFilter);
	}
	if (filters.types?.length) {
		parts.push({ type: { $in: filters.types } });
	}
	if (filters.sources?.length) {
		parts.push({ source: { $in: filters.sources } });
	}
	if (filters.importance?.min !== undefined) {
		parts.push({ importance: { $gte: filters.importance.min } });
	}
	if (filters.importance?.max !== undefined) {
		parts.push({ importance: { $lte: filters.importance.max } });
	}
	if (filters.time) {
		const key = filters.time.field;
		const range: Record<string, number> = {};
		if (filters.time.from) {
			range.$gte = isoToMs(filters.time.from);
		}
		if (filters.time.to) {
			range.$lte = isoToMs(filters.time.to);
		}
		if (Object.keys(range).length > 0) {
			parts.push({ [key]: range });
		}
	}
	if (parts.length === 0) {
		return undefined;
	}
	return parts.length === 1
		? (parts[0] as VectorizeVectorMetadataFilter)
		: ({ $and: parts } as VectorizeVectorMetadataFilter);
}
