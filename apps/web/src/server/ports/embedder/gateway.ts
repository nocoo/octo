import { APP_VERSION, versionLabel } from "../../../lib/version";
import { assertVectorValues } from "../../search/vector-write";
import { EmbeddingFailure } from "./diagnostics";
import type { EmbedderConfig, QueryEmbedder } from "./types";

export class EmbeddingDimensionError extends EmbeddingFailure {
	constructor(readonly actualDims: number) {
		super({ stage: "dims" }, "vector dimension mismatch");
	}
}

export class GatewayEmbedder implements QueryEmbedder {
	constructor(private readonly config: EmbedderConfig) {}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
		let stage: "request" | "parse" = "request";
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
				throw new EmbeddingFailure(
					{
						stage: res.status >= 300 && res.status < 400 ? "redirect" : "status",
						upstream_status: res.status,
					},
					`embedder status ${res.status}`,
				);
			}
			stage = "parse";
			const body = (await res.json()) as {
				data?: Array<{ embedding?: unknown; index?: unknown } | null>;
			};
			if (!Array.isArray(body.data) || body.data.length !== texts.length) {
				throw new EmbeddingFailure({ stage }, "embedding count mismatch");
			}
			const ordered = new Array<number[]>(texts.length);
			for (const row of body.data) {
				const values = row?.embedding;
				if (!Array.isArray(values)) throw new EmbeddingFailure({ stage }, "invalid embedding");
				if (values.length !== this.config.dims) throw new EmbeddingDimensionError(values.length);
				const index = row?.index;
				if (
					typeof index !== "number" ||
					!Number.isInteger(index) ||
					index < 0 ||
					index >= texts.length ||
					ordered[index] !== undefined
				) {
					throw new EmbeddingFailure({ stage }, "invalid embedding index");
				}
				ordered[index] = assertVectorValues(values, this.config.dims);
			}
			return ordered;
		} catch (error) {
			if (controller.signal.aborted) throw new EmbeddingFailure({ stage: "timeout" });
			if (error instanceof EmbeddingFailure) throw error;
			throw new EmbeddingFailure({ stage });
		} finally {
			clearTimeout(timeout);
		}
	}
}
