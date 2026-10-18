import { describe, expect, it } from "vitest";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";

describe("GET /api/live", () => {
	it("returns version, local build identity and d1_marker without origin", async () => {
		const res = await fetch(`${base}/api/live`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			name: string;
			d1_marker: string;
			version: string;
			git_sha: string;
			build_time: string;
			database: { connected: boolean };
		};
		expect(body.name).toBe("octo");
		expect(body.d1_marker).toBe("test");
		expect(body.database.connected).toBe(true);
		expect(body.version).toBeTruthy();
		expect(body.git_sha).toBe("unknown");
		expect(body.build_time).toBe("unknown");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("X-Octo-Version")).toBe(body.version);
		expect(res.headers.get("X-Request-Id")).toBeTruthy();
	});

	it("returns the error envelope for unknown api routes", async () => {
		const res = await fetch(`${base}/api/missing`, { headers: { "X-Request-Id": "e2e-live" } });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: { code: "not_found", message: "not found", request_id: "e2e-live" },
		});
	});
});
