import type { Env } from "../env";
import { GatewayEmbedder } from "../ports/embedder/gateway";
import type { QueryEmbedder } from "../ports/embedder/types";
import { vectorBlobFromValues } from "../search/vector-write";
import { configFromState, readEmbeddingState, SETTINGS_SNAPSHOT_SQL } from "./config";

export const BACKFILL_TEXT_MAX_CHARS = 16_000;

type ObservedMemory = {
	id: string;
	title: string;
	body: string;
	version: number;
	content_hash: string;
	vector_hash: string | null;
	vector_model: string | null;
	vector_dim: number | null;
};

export async function backfillMemory(env: Env, memoryId: string): Promise<boolean> {
	try {
		const state = await readEmbeddingState(env);
		if (!state.settings.backfill_enabled) return false;
		const config = await configFromState(env, state);
		if (!config) return false;
		const memory = await env.DB.prepare(
			`SELECT m.id, m.title, m.body, m.version, m.content_hash, v.content_hash AS vector_hash, v.embedding_model AS vector_model, v.dim AS vector_dim FROM memories m LEFT JOIN memory_vectors v ON v.memory_id = m.id AND v.profile_id = ? WHERE m.id = ? AND m.deleted_at IS NULL`,
		)
			.bind(config.profileId, memoryId)
			.first<ObservedMemory>();
		if (
			!memory ||
			(memory.vector_hash === memory.content_hash &&
				memory.vector_model === config.model &&
				memory.vector_dim === config.dims)
		)
			return false;
		const embedder: QueryEmbedder = new GatewayEmbedder(config);
		const vectors = await embedder.embed([
			`${memory.title}\n\n${memory.body}`.slice(0, BACKFILL_TEXT_MAX_CHARS),
		]);
		const blob = vectorBlobFromValues(vectors.flat(), config.dims);
		const result =
			await env.DB.prepare(`INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, indexed_at, updated_at)
			SELECT m.id, ?, ?, ?, ?, m.content_hash, NULL, ? FROM memories m
			WHERE m.id = ? AND m.content_hash = ? AND m.version = ? AND m.deleted_at IS NULL
			AND (SELECT COUNT(*) FROM embedding_profiles WHERE active = 1) = 1
			AND EXISTS (SELECT 1 FROM embedding_profiles WHERE id = ? AND model = ? AND dims = ? AND active = 1)
			AND ${SETTINGS_SNAPSHOT_SQL} = ?
			ON CONFLICT(memory_id, profile_id) DO UPDATE SET embedding_model = excluded.embedding_model, dim = excluded.dim, vector = excluded.vector, content_hash = excluded.content_hash, indexed_at = NULL, updated_at = excluded.updated_at
			WHERE memory_vectors.content_hash <> excluded.content_hash OR memory_vectors.embedding_model <> excluded.embedding_model OR memory_vectors.dim <> excluded.dim`)
				.bind(
					config.profileId,
					config.model,
					config.dims,
					blob,
					Date.now(),
					memoryId,
					memory.content_hash,
					memory.version,
					config.profileId,
					config.model,
					config.dims,
					state.snapshot,
				)
				.run();
		return result.meta.changes === 1;
	} catch {
		console.error("embedding backfill failed");
		return false;
	}
}
