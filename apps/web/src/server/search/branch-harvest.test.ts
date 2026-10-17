import { describe, expect, it, vi } from "vitest";
import { GatewayEmbedder } from "../ports/embedder/gateway";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { runFtsChannel } from "./fts-channel";
import { encodeFloat32Vector, l2Normalize } from "./math";
import { highlightSnippet } from "./snippet";
import { FTS_SHORT_SCAN_LIMIT, tokenizeQuery } from "./tokenizer";

describe("branch harvest", () => {
	it("covers snippet suffix and tokenizer short parts", () => {
		expect(highlightSnippet("abcdef", ["cde"])).not.toContain("…");
		expect(tokenizeQuery("a").shortTerms).toEqual(["a"]);
	});

	it("marks like scans partial at the limit", async () => {
		const rows = Array.from({ length: FTS_SHORT_SCAN_LIMIT }, (_, i) => ({ id: `m${i}` }));
		const db = {
			prepare: () => ({
				bind: () => ({ all: async () => ({ results: rows }) }),
			}),
		} as never;
		const result = await runFtsChannel(db, "ab", ["s1"], undefined, FTS_SHORT_SCAN_LIMIT);
		expect(result.partial).toBe(true);
	});

	it("scores multiple brute-force vectors", async () => {
		const a = l2Normalize([1, 0]);
		const b = l2Normalize([0, 1]);
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{ memory_id: "m1", dim: 2, vector: encodeFloat32Vector(a).buffer },
							{ memory_id: "m2", dim: 2, vector: encodeFloat32Vector(b).buffer },
						],
					}),
				}),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		const hits = await store.query({ vector: a, topK: 2, returnMetadata: false });
		expect(hits).toHaveLength(2);
	});

	it("embeds multiple inputs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
						}),
						{ status: 200 },
					),
			),
		);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9",
			apiKey: "k",
			model: "m",
			dims: 2,
			userAgent: "octo/0.1.0",
		});
		const vectors = await embedder.embed(["a", "b"]);
		expect(vectors).toHaveLength(2);
		vi.unstubAllGlobals();
	});
});
