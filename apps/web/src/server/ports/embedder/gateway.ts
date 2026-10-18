import { APP_VERSION, versionLabel } from "../../../lib/version";
import { assertVectorValues } from "../../search/vector-write";
import type { EmbedderConfig, QueryEmbedder } from "./types";

export class EmbeddingDimensionError extends Error {
	readonly code = "vector_dimension_mismatch";
	constructor(readonly actualDims: number) {
		super("vector dimension mismatch");
	}
}

export class GatewayEmbedder implements QueryEmbedder {
	constructor(private readonly config: EmbedderConfig) {}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
		try {
			const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
			const endpoint = `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}/embeddings`;
			const res = await fetch(endpoint, {
				method: "POST",
				redirect: "manual",
				headers: {
					Authorization: `Bearer ${this.config.apiKey}`,
					"Content-Type": "application/json",
					"User-Agent": versionLabel(APP_VERSION),
				},
				body: JSON.stringify({ model: this.config.model, input: texts }),
				signal: controller.signal,
			});
			if (!res.ok) {
				throw new Error(`embedder status ${res.status}`);
			}
			const body = (await res.json()) as {
				data?: Array<{ embedding?: unknown } | null>;
			};
			if (!Array.isArray(body.data) || body.data.length !== texts.length) {
				throw new Error("embedding count mismatch");
			}
			return body.data.map((row) => {
				const values = row?.embedding;
				if (!Array.isArray(values)) throw new Error("invalid embedding");
				if (values.length !== this.config.dims) throw new EmbeddingDimensionError(values.length);
				return assertVectorValues(values, this.config.dims);
			});
		} finally {
			clearTimeout(timeout);
		}
	}
}
