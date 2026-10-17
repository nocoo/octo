import { l2Normalize } from "../../search/math";
import type { EmbedderConfig, QueryEmbedder } from "./types";

export class GatewayEmbedder implements QueryEmbedder {
	constructor(private readonly config: EmbedderConfig) {}

	async embed(texts: string[]): Promise<number[][]> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
		try {
			const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/v1/embeddings`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.config.apiKey}`,
					"Content-Type": "application/json",
					"User-Agent": this.config.userAgent,
				},
				body: JSON.stringify({ model: this.config.model, input: texts }),
				signal: controller.signal,
			});
			if (!res.ok) {
				throw new Error(`embedder status ${res.status}`);
			}
			const body = (await res.json()) as {
				data?: Array<{ embedding?: number[] }>;
			};
			const vectors = (body.data ?? []).map((row) => row.embedding ?? []);
			return vectors.map((values) => {
				if (values.length !== this.config.dims) {
					throw new Error("vector dimension mismatch");
				}
				return l2Normalize(values);
			});
		} finally {
			clearTimeout(timeout);
		}
	}
}
