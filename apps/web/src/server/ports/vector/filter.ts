import type { MemoryFilters } from "../../../lib/schema/filters";
import { isoToMs } from "../../search/time";

type FieldFilter = Record<string, unknown>;

export function buildVectorMetadataFilter(
	filters: MemoryFilters | undefined,
	spaceSlugs: string[],
): VectorizeVectorMetadataFilter | undefined {
	const out: FieldFilter = {};
	if (spaceSlugs.length > 0) {
		out.space = { $in: spaceSlugs };
	}
	if (!filters) {
		return Object.keys(out).length === 0 ? undefined : (out as VectorizeVectorMetadataFilter);
	}
	if (filters.types?.length) {
		out.type = { $in: filters.types };
	}
	if (filters.sources?.length) {
		out.source = { $in: filters.sources };
	}
	if (filters.importance?.min !== undefined || filters.importance?.max !== undefined) {
		const importance: Record<string, number> = {};
		if (filters.importance.min !== undefined) {
			importance.$gte = filters.importance.min;
		}
		if (filters.importance.max !== undefined) {
			importance.$lte = filters.importance.max;
		}
		out.importance = importance;
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
			out[key] = range;
		}
	}
	return Object.keys(out).length === 0 ? undefined : (out as VectorizeVectorMetadataFilter);
}
