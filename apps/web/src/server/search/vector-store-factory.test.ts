import { describe, expect, it, vi } from "vitest";
import { CloudflareVectorStore } from "../ports/vector/cloudflare";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { createSearchVectorStore } from "./vector-store-factory";

describe("createSearchVectorStore", () => {
	it("uses CloudflareVectorStore when VEC is bound", () => {
		const query = vi.fn(async () => ({ matches: [] }));
		const store = createSearchVectorStore(
			{
				DB: {} as D1Database,
				FILES: {} as R2Bucket,
				ASSETS: {} as Fetcher,
				VEC: { query } as never,
			},
			{} as D1Database,
			"p1",
			{ clauses: ["1=1"], binds: [] },
		);
		expect(store).toBeInstanceOf(CloudflareVectorStore);
	});

	it("falls back to D1 brute force without VEC", () => {
		const store = createSearchVectorStore(
			{ DB: {} as D1Database, FILES: {} as R2Bucket, ASSETS: {} as Fetcher },
			{} as D1Database,
			"p1",
			{ clauses: ["1=1"], binds: [] },
		);
		expect(store).toBeInstanceOf(D1BruteForceVectorStore);
	});
});
