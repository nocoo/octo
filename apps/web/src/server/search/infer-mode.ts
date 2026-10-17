import type { SearchRequest } from "../../lib/schema/search";

export function inferSearchMode(req: SearchRequest): "hybrid" | "fts" | "vector" {
	if (req.mode) {
		return req.mode;
	}
	if (req.query && req.vector) {
		return "hybrid";
	}
	if (req.vector) {
		return "vector";
	}
	return "fts";
}
