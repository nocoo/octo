import { type SearchRequest, searchRequestSchema } from "../../lib/schema/search";
import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { errorMessage, filtersFromUrl, pageLimit } from "./memories";

export interface SearchScores {
	fused: number;
	fts: { rank: number; bm25: number; normalized: number } | null;
	vector: { rank: number; similarity: number; normalized: number } | null;
}
export interface SearchItem {
	id: string;
	title: string;
	space: string;
	type: string;
	tags: string[];
	updated_at: string;
	snippet?: string;
	scores: SearchScores;
}
export interface SearchResult {
	items: SearchItem[];
	channels: {
		fts: { candidates: number; partial: boolean };
		vector: { candidates?: number; truncated?: boolean; profile?: string | null; skipped?: string };
	};
}

export function searchFromUrl(params: URLSearchParams): SearchRequest {
	const query = (params.get("q") ?? "").trim();
	const fts = Number(params.get("fts_weight") ?? 1);
	const vector = Number(params.get("vector_weight") ?? 1);
	if (fts === 0 && vector === 0) throw new Error("至少一个搜索通道的权重须大于零。");
	return searchRequestSchema.parse({
		query,
		mode: params.get("mode") ?? "hybrid",
		fusion: {
			method: params.get("fusion") ?? "rrf",
			k: Number(params.get("k") ?? 60),
			weights: { fts, vector },
		},
		filters: filtersFromUrl(params),
		limit: pageLimit(params),
		include: ["snippet"],
	});
}

export function scoreBars(
	scores: SearchScores,
	maxFused: number,
): { fused: number; fts: number | null; vector: number | null } {
	const percent = (value: number): number => Math.min(100, Math.max(0, value * 100));
	return {
		fused: maxFused > 0 ? percent(scores.fused / maxFused) : 0,
		fts: scores.fts === null ? null : percent(scores.fts.normalized),
		vector: scores.vector === null ? null : percent(scores.vector.normalized),
	};
}

export function snippetParts(snippet: string): { text: string; marked: boolean; offset: number }[] {
	let marked = false;
	let offset = 0;
	const parts: { text: string; marked: boolean; offset: number }[] = [];
	const entities: Record<string, string> = {
		"&amp;": "&",
		"&lt;": "<",
		"&gt;": ">",
		"&quot;": '"',
		"&#39;": "'",
	};
	for (const text of snippet.split(/(<mark>|<\/mark>)/g)) {
		if (text === "<mark>") marked = true;
		else if (text === "</mark>") marked = false;
		else if (text) {
			const decoded = text.replace(
				/&(?:amp|lt|gt|quot|#39);/g,
				(entity) => entities[entity] as string,
			);
			parts.push({ text: decoded, marked, offset });
			offset += decoded.length;
		}
	}
	return parts;
}

export class SearchModel extends Store<{
	result: SearchResult | null;
	loading: boolean;
	error: string | null;
	fallback: boolean;
}> {
	private generation = 0;
	private cache = new Map<string, SearchResult>();
	constructor(private readonly api: AdminClient = adminApi) {
		super({ result: null, loading: false, error: null, fallback: false });
	}
	async load(params: URLSearchParams): Promise<void> {
		const generation = ++this.generation;
		if (!(params.get("q") ?? "").trim()) {
			this.set({ result: null, loading: false, error: null, fallback: false });
			return;
		}
		try {
			const json = searchFromUrl(params);
			const key = JSON.stringify(json);
			const cached = this.cache.get(key);
			this.set({
				loading: true,
				error: null,
				result: cached ?? null,
				fallback: cached?.channels.vector.skipped === "embedder_unavailable",
			});
			const result = await this.api.request<SearchResult>("/search", { method: "POST", json });
			this.cache.set(key, result);
			if (generation === this.generation)
				this.set({
					result,
					loading: false,
					fallback: result.channels.vector.skipped === "embedder_unavailable",
				});
		} catch (error) {
			if (generation === this.generation) this.set({ loading: false, error: errorMessage(error) });
		}
	}
}
