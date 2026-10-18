import type { SearchRequest } from "../../lib/schema/search";
import type { Env } from "../env";
import { EmbeddingFailure, reportEmbeddingFailure } from "../ports/embedder/diagnostics";
import { GatewayEmbedder } from "../ports/embedder/gateway";
import type { AuthzContext } from "../search/authz";
import { searchMemories } from "../search/service";
import { configFromState, readEmbeddingState } from "./config";

export async function searchAdminMemories(env: Env, authz: AuthzContext, input: SearchRequest) {
	let request = input;
	let skipped = false;
	if (input.query && !input.vector && input.mode !== "fts") {
		let baseUrl: string | null = null;
		let stage: "config" | "request" = "config";
		try {
			const state = await readEmbeddingState(env);
			baseUrl = state.settings.base_url;
			const config = await configFromState(env, state);
			if (!config) throw new EmbeddingFailure({ stage: "config" });
			stage = "request";
			const values = (await new GatewayEmbedder(config).embed([input.query]))[0];
			if (!values) throw new EmbeddingFailure({ stage: "parse" });
			request = {
				...input,
				mode: input.mode ?? "hybrid",
				vector: { profile: config.profileId, values },
			};
		} catch (error) {
			reportEmbeddingFailure("embedding_query_failed", error, baseUrl, stage);
			request = { ...input, mode: "fts" };
			skipped = true;
		}
	}
	const result = await searchMemories(authz, request, { db: env.DB, env });
	return skipped
		? {
				...result,
				channels: { ...result.channels, vector: { skipped: "embedder_unavailable" as const } },
			}
		: result;
}
