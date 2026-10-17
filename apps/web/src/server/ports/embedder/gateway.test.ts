import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayEmbedder } from "./gateway";

const config = { baseUrl: "http://127.0.0.1:9/", apiKey: "k", model: "m", dims: 2 };
afterEach(() => vi.unstubAllGlobals());

describe("GatewayEmbedder", () => {
	it("strips a trailing slash from the base URL", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo) => {
			expect(String(input)).toBe("http://127.0.0.1:9/v1/embeddings");
			return Response.json({ data: [{ embedding: [1, 0] }] });
		});
		vi.stubGlobal("fetch", fetchMock);
		expect(await new GatewayEmbedder(config).embed(["x"])).toEqual([[1, 0]]);
	});

	it("rejects a failed upstream", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 500 })),
		);
		await expect(new GatewayEmbedder(config).embed(["x"])).rejects.toThrow("embedder status 500");
	});

	it("rejects a missing embedding", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{}] })),
		);
		await expect(new GatewayEmbedder(config).embed(["x"])).rejects.toThrow("dimension mismatch");
	});

	it("handles absent or empty data arrays", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({})),
		);
		expect(await new GatewayEmbedder(config).embed([])).toEqual([]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [] })),
		);
		expect(await new GatewayEmbedder(config).embed([])).toEqual([]);
	});
});
