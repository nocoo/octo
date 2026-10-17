import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { APP_VERSION, versionLabel } from "../../../lib/version";
import { GatewayEmbedder } from "./gateway";
import { startLocalEmbedderStub } from "./local-stub";

function postJson(url: string, body: string, userAgent: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			url,
			{ method: "POST", headers: { "Content-Type": "application/json", "User-Agent": userAgent } },
			(res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			},
		);
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

describe("local embedder stub", () => {
	it("rejects requests without the expected User-Agent", async () => {
		const stub = await startLocalEmbedderStub(versionLabel(APP_VERSION));
		const status = await postJson(
			`${stub.baseUrl}/v1/embeddings`,
			JSON.stringify({ input: ["x"] }),
			"wrong/0.0.0",
		);
		expect(status).toBe(403);
		await stub.close();
	});

	it("asserts octo User-Agent, timeout, and dims via GatewayEmbedder", async () => {
		const expectedUa = versionLabel(APP_VERSION);
		const stub = await startLocalEmbedderStub(expectedUa);
		const embedder = new GatewayEmbedder({
			baseUrl: stub.baseUrl,
			apiKey: "test-key",
			model: "text-embedding-3-small",
			dims: 2,
			userAgent: expectedUa,
			timeoutMs: 5_000,
		});
		const vectors = await embedder.embed(["hello"]);
		expect(stub.getLastUserAgent()).toBe(expectedUa);
		expect(vectors[0]?.[0]).toBeCloseTo(0.6);
		await stub.close();
	});
});
