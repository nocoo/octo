import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../lib/version";
import type { Env } from "../env";
import { liveResponse } from "./live";

function envWith(first: unknown | (() => never)): Env {
	const stmt = {
		bind: () => stmt,
		first: async () => {
			if (typeof first === "function") {
				(first as () => never)();
			}
			return first as Record<string, unknown> | null;
		},
	};
	return {
		DB: { prepare: () => stmt } as unknown as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("ok")) } as unknown as Fetcher,
	};
}

describe("liveResponse", () => {
	it("returns version and a D1 probe", async () => {
		const res = await liveResponse(envWith({ n: 1, value: "test" }));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({
			status: "ok",
			name: "octo",
			version: APP_VERSION,
			database: { connected: true },
			d1_marker: "test",
		});
	});

	it("returns 503 uncached when D1 fails", async () => {
		const res = await liveResponse(
			envWith(() => {
				throw new Error("d1 down");
			}),
		);
		expect(res.status).toBe(503);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toMatchObject({
			status: "error",
			database: { connected: false },
			d1_marker: null,
		});
	});
});
