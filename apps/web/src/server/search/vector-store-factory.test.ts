import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { CloudflareVectorStore } from "../ports/vector/cloudflare";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { createSearchVectorStore } from "./vector-store-factory";

const db = {} as D1Database;
const base = { clauses: ["1=1"], binds: [] };
const env = { DB: db, FILES: {} as R2Bucket, ASSETS: {} as Fetcher };

describe("createSearchVectorStore", () => {
	it("uses the production VEC binding", () => {
		const query = vi.fn(async () => ({ matches: [] }));
		expect(
			createSearchVectorStore({ ...env, VEC: { query } as never }, db, "p1", base),
		).toBeInstanceOf(CloudflareVectorStore);
	});

	it.each([undefined, "production", "invalid"])(
		"never falls back for production mode %s",
		(RESOURCE_ENV) => {
			expect(() =>
				createSearchVectorStore({ ...env, RESOURCE_ENV } as Env, db, "p1", base),
			).toThrow("VEC");
		},
	);

	it.each(["test", "development"])("explicit %s uses D1 even when VEC is bound", (RESOURCE_ENV) => {
		const query = vi.fn();
		expect(
			createSearchVectorStore({ ...env, RESOURCE_ENV, VEC: { query } as never }, db, "p1", base),
		).toBeInstanceOf(D1BruteForceVectorStore);
		expect(query).not.toHaveBeenCalled();
	});

	it("declares the production binding without enabling remote local access", () => {
		const config = parse(readFileSync("wrangler.toml", "utf8"));
		expect(config.vectorize).toEqual([
			{ binding: "VEC", index_name: "octo-vec-te3-small-1536", remote: false },
		]);
	});
});
