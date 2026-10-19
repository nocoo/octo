import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { EmbeddingFailure, reportEmbeddingFailure } from "../ports/embedder/diagnostics";
import { GatewayEmbedder } from "../ports/embedder/gateway";
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

type CacheEntry = { key: string; text: string; vector: ArrayBuffer | Uint8Array | null };
const CACHE_LEASE_MS = 60_000;

async function cacheKey(text: string, model: string, dims: number): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify([text, model, dims])),
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function backfillMemories(env: Env, memoryIds: string[]): Promise<number> {
	if (memoryIds.length === 0) return 0;
	let baseUrl: string | null = null;
	const token = crypto.randomUUID();
	const claimed: CacheEntry[] = [];
	try {
		const state = await readEmbeddingState(env);
		if (!state.settings.backfill_enabled) return 0;
		baseUrl = state.settings.base_url;
		const profile = state.profile;
		const memories: Array<ObservedMemory & { cache: CacheEntry }> = [];
		const cache = new Map<string, CacheEntry>();
		for (const id of new Set(memoryIds)) {
			const memory = await env.DB.prepare(
				`SELECT memory.id, memory.title, memory.body, memory.version, memory.content_hash, vector.content_hash AS vector_hash, vector.embedding_model AS vector_model, vector.dim AS vector_dim FROM memories memory LEFT JOIN memory_vectors vector ON vector.memory_id = memory.id AND vector.profile_id = ? WHERE memory.id = ? AND memory.deleted_at IS NULL`,
			)
				.bind(profile.id, id)
				.first<ObservedMemory>();
			if (
				!memory ||
				(memory.vector_hash === memory.content_hash &&
					memory.vector_model === profile.model &&
					memory.vector_dim === profile.dims)
			)
				continue;
			const text = `${memory.title}\n\n${memory.body}`.slice(0, BACKFILL_TEXT_MAX_CHARS);
			const key = await cacheKey(text, profile.model, profile.dims);
			let entry = cache.get(key);
			if (!entry) {
				const now = Date.now();
				const acquired = await env.DB.prepare(`INSERT INTO embedding_cache
					(cache_key, embedding_model, dim, vector, lease_token, lease_until, updated_at)
					VALUES (?, ?, ?, NULL, ?, ?, ?)
					ON CONFLICT(cache_key) DO UPDATE SET lease_token = excluded.lease_token,
					lease_until = excluded.lease_until, updated_at = excluded.updated_at
					WHERE embedding_cache.vector IS NULL AND embedding_cache.lease_until <= ?
					RETURNING cache_key`)
					.bind(key, profile.model, profile.dims, token, now + CACHE_LEASE_MS, now, now)
					.first();
				if (acquired) {
					entry = { key, text, vector: null };
					claimed.push(entry);
				} else {
					const ready = await env.DB.prepare(
						"SELECT vector FROM embedding_cache WHERE cache_key = ?",
					)
						.bind(key)
						.first<{ vector: ArrayBuffer | null }>();
					if (!ready?.vector) throw new ApiError("unavailable", "embedding cache is busy");
					entry = { key, text, vector: ready.vector };
				}
				cache.set(key, entry);
			}
			memories.push({ ...memory, cache: entry });
		}
		if (claimed.length > 0) {
			const config = await configFromState(env, state);
			if (!config) throw new EmbeddingFailure({ stage: "config" });
			for (let offset = 0; offset < claimed.length; offset += 100) {
				const batch = claimed.slice(offset, offset + 100);
				const keys = new Set(batch.map((entry) => entry.key));
				await env.DB.batch(
					memories
						.filter((memory) => keys.has(memory.cache.key))
						.map((memory) =>
							env.DB.prepare(`INSERT INTO memory_embedding_calls (memory_id, profile_id, calls)
							SELECT ?, ?, 1 WHERE EXISTS (SELECT 1 FROM memories WHERE id = ?)
							ON CONFLICT(memory_id, profile_id) DO UPDATE SET calls = calls + 1`).bind(
								memory.id,
								profile.id,
								memory.id,
							),
						),
				);
				const vectors = await new GatewayEmbedder(config).embed(batch.map((entry) => entry.text));
				for (const [index, entry] of batch.entries()) {
					entry.vector = vectorBlobFromValues(vectors[index] as number[], profile.dims);
					const stored = await env.DB.prepare(`UPDATE embedding_cache SET vector = ?,
						lease_token = NULL, lease_until = 0, updated_at = ? WHERE cache_key = ? AND lease_token = ?`)
						.bind(entry.vector, Date.now(), entry.key, token)
						.run();
					if (stored.meta.changes === 0)
						throw new ApiError("unavailable", "embedding cache claim lost");
				}
			}
			claimed.length = 0;
		}
		if (memories.length === 0) return 0;
		const results = await env.DB.batch(
			memories.map((memory) =>
				env.DB.prepare(`INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, indexed_at, updated_at)
			SELECT memory.id, ?, ?, ?, ?, memory.content_hash, NULL, ? FROM memories memory
			WHERE memory.id = ? AND memory.content_hash = ? AND memory.version = ? AND memory.deleted_at IS NULL
			AND (SELECT COUNT(*) FROM embedding_profiles WHERE active = 1) = 1
			AND EXISTS (SELECT 1 FROM embedding_profiles WHERE id = ? AND model = ? AND dims = ? AND active = 1)
			AND ${SETTINGS_SNAPSHOT_SQL} = ?
			ON CONFLICT(memory_id, profile_id) DO UPDATE SET embedding_model = excluded.embedding_model, dim = excluded.dim, vector = excluded.vector, content_hash = excluded.content_hash, indexed_at = NULL, updated_at = excluded.updated_at
			WHERE memory_vectors.content_hash <> excluded.content_hash OR memory_vectors.embedding_model <> excluded.embedding_model OR memory_vectors.dim <> excluded.dim`).bind(
					profile.id,
					profile.model,
					profile.dims,
					memory.cache.vector,
					Date.now(),
					memory.id,
					memory.content_hash,
					memory.version,
					profile.id,
					profile.model,
					profile.dims,
					state.snapshot,
				),
			),
		);
		return results.filter((result) => result.meta.changes > 0).length;
	} catch (error) {
		const reason = reportEmbeddingFailure("embedding_backfill_failed", error, baseUrl);
		throw error instanceof ApiError ? error : new EmbeddingFailure(reason);
	} finally {
		if (claimed.length > 0)
			await env.DB.prepare(
				"UPDATE embedding_cache SET lease_token = NULL, lease_until = 0 WHERE lease_token = ?",
			)
				.bind(token)
				.run();
	}
}

export async function backfillMemory(env: Env, memoryId: string): Promise<boolean> {
	return (await backfillMemories(env, [memoryId])) > 0;
}
