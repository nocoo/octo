import type { SearchRequest } from "../../lib/schema/search";
import type { Env } from "../env";
import { GatewayEmbedder } from "../ports/embedder/gateway";
import type { AuthzContext } from "../search/authz";
import { searchMemories } from "../search/service";
import { loadEmbeddingConfig } from "./config";

export async function searchAdminMemories(env: Env, authz: AuthzContext, input: SearchRequest) {
	let request = input;
	let skipped = false;
	if (input.query && !input.vector && input.mode !== "fts") {
		try {
			const config = await loadEmbeddingConfig(env);
			if (!config) throw new Error("embedder unavailable");
			const values = (await new GatewayEmbedder(config).embed([input.query]))[0];
			if (!values) throw new Error("embedder unavailable");
			request = {
				...input,
				mode: input.mode ?? "hybrid",
				vector: { profile: config.profileId, values },
			};
		} catch {
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
