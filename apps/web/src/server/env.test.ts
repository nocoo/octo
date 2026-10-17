import { describe, expect, it } from "vitest";
import { type Env, WORKER_BINDINGS } from "./env";

describe("Env", () => {
	it("types optional secrets separately from bindings", () => {
		const env: Env = {
			DB: {} as D1Database,
			FILES: {} as R2Bucket,
			ASSETS: { fetch: () => Promise.resolve(new Response("ok")) } as unknown as Fetcher,
		};
		expect(env.API_KEY_PEPPER).toBeUndefined();
		expect(WORKER_BINDINGS).toEqual(["DB", "FILES", "ASSETS"]);
	});
});
