import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION, versionLabel } from "../../../lib/version";
import { GatewayEmbedder } from "./gateway";
import { type EmbedderStub, startLocalEmbedderStub } from "./local-stub";

const expectedUa = versionLabel(APP_VERSION);
const stubs: EmbedderStub[] = [];
afterEach(async () => {
	for (const stub of stubs.splice(0)) await stub.close();
});
async function stub(options: Parameters<typeof startLocalEmbedderStub>[1] = {}) {
	const result = await startLocalEmbedderStub(expectedUa, options);
	stubs.push(result);
	return result;
}
function embedder(baseUrl: string, timeoutMs?: number) {
	return new GatewayEmbedder({
		baseUrl,
		apiKey: "test-key",
		model: "text-embedding-3-small",
		dims: 2,
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	});
}
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
		req.end(body);
	});
}

describe("real local embedding gateway", () => {
	it("requires the versioned UA and validates the real request", async () => {
		const local = await stub();
		expect(
			await postJson(`${local.baseUrl}/v1/embeddings`, JSON.stringify({ input: ["x"] }), ""),
		).toBe(403);
		const vectors = await embedder(local.baseUrl).embed(["hello", "world"]);
		expect(local.getLastRequest()).toEqual({
			userAgent: expectedUa,
			authorization: "Bearer test-key",
			body: { model: "text-embedding-3-small", input: ["hello", "world"] },
		});
		expect(vectors).toEqual([
			[0.6, 0.8],
			[0.6, 0.8],
		]);
	});

	it.each([
		{ embedding: [1], stage: "dims" },
		{ embedding: [0, 0], stage: "parse" },
		{ embedding: [NaN, 0], stage: "parse" },
	])("rejects malformed real upstream vectors: $embedding", async ({ embedding, stage }) => {
		const local = await stub({ embedding });
		await expect(embedder(local.baseUrl).embed(["x"])).rejects.toMatchObject({ reason: { stage } });
	});

	it("rejects a real HTTP response missing an embedding for one input", async () => {
		const local = await stub({ responseBody: { data: [{ embedding: [3, 4] }] } });
		await expect(embedder(local.baseUrl).embed(["hello", "world"])).rejects.toThrow(
			"embedding count mismatch",
		);
		expect(local.getLastRequest()?.body).toMatchObject({ input: ["hello", "world"] });
	});

	it("normalizes extreme finite gateway values", async () => {
		const local = await stub({ embedding: [3e300, 4e300] });
		expect(await embedder(local.baseUrl).embed(["x"])).toEqual([[0.6, 0.8]]);
	});

	it("rejects a real upstream error status", async () => {
		const local = await stub({ status: 503 });
		await expect(embedder(local.baseUrl).embed(["x"])).rejects.toThrow("status 503");
	});

	it("aborts a delayed HTTP request after the default five seconds", async () => {
		const local = await stub({ delayMs: 10_000 });
		const start = performance.now();
		await expect(embedder(local.baseUrl).embed(["slow"])).rejects.toMatchObject({
			reason: { stage: "timeout" },
		});
		expect(performance.now() - start).toBeGreaterThanOrEqual(4_500);
		expect(performance.now() - start).toBeLessThan(8_000);
		expect(local.getLastRequest()?.body).toMatchObject({ input: ["slow"] });
	}, 10_000);

	it("honors an explicit shorter abort timeout", async () => {
		const local = await stub({ delayMs: 10_000 });
		await expect(embedder(local.baseUrl, 20).embed(["slow"])).rejects.toMatchObject({
			reason: { stage: "timeout" },
		});
	});

	it("isolates malformed stub calls and handles an empty input", async () => {
		const local = await stub();
		expect((await fetch(`${local.baseUrl}/other`)).status).toBe(404);
		expect(await postJson(`${local.baseUrl}/v1/embeddings`, "{", expectedUa)).toBe(400);
		expect(await postJson(`${local.baseUrl}/v1/embeddings`, "{}", expectedUa)).toBe(200);
	});
});
