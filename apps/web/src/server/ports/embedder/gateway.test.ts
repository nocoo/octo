import { describe, expect, it, vi } from "vitest";
import { GatewayEmbedder } from "./gateway";

describe("GatewayEmbedder", () => {
	it("strips a trailing slash from the base URL", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo) => {
			expect(String(input)).toBe("http://127.0.0.1:9/v1/embeddings");
			return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9/",
			apiKey: "k",
			model: "m",
			dims: 2,
			userAgent: "octo/0.1.0",
		});
		await embedder.embed(["x"]);
		vi.unstubAllGlobals();
	});

	it("sends User-Agent and normalizes embeddings", async () => {
		let seenUa = "";
		const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
			if (!init) {
				seenUa = "";
			} else {
				const headers = init.headers;
				seenUa =
					headers && typeof headers === "object" && !Array.isArray(headers)
						? String((headers as Record<string, string>)["User-Agent"] ?? "")
						: "";
			}
			return new Response(JSON.stringify({ data: [{ embedding: [3, 4] }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9",
			apiKey: "k",
			model: "text-embedding-3-small",
			dims: 2,
			userAgent: "octo/0.1.0",
			timeoutMs: 2_000,
		});
		const vectors = await embedder.embed(["hello"]);
		const vec = vectors[0];
		if (!vec) {
			throw new Error("missing embedding");
		}
		expect(seenUa).toBe("octo/0.1.0");
		expect(vec[0]).toBeCloseTo(0.6);
		expect(vec[1]).toBeCloseTo(0.8);
		vi.unstubAllGlobals();
	});

	it("rejects bad status and dimension mismatch", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 500 })),
		);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9",
			apiKey: "k",
			model: "m",
			dims: 2,
			userAgent: "octo/0.1.0",
		});
		await expect(embedder.embed(["x"])).rejects.toThrow("embedder status 500");
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () => new Response(JSON.stringify({ data: [{ embedding: [1] }] }), { status: 200 }),
			),
		);
		await expect(embedder.embed(["x"])).rejects.toThrow("vector dimension mismatch");
		vi.unstubAllGlobals();
	});

	it("rejects missing embedding rows", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 })),
		);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9",
			apiKey: "k",
			model: "m",
			dims: 2,
			userAgent: "octo/0.1.0",
		});
		await expect(embedder.embed(["x"])).rejects.toThrow("vector dimension mismatch");
		vi.unstubAllGlobals();
	});

	it("treats a missing data array as empty", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
		);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9",
			apiKey: "k",
			model: "m",
			dims: 2,
			userAgent: "octo/0.1.0",
		});
		expect(await embedder.embed(["x"])).toEqual([]);
		vi.unstubAllGlobals();
	});

	it("returns an empty array when the gateway sends no embeddings", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
		);
		const embedder = new GatewayEmbedder({
			baseUrl: "http://127.0.0.1:9",
			apiKey: "k",
			model: "m",
			dims: 2,
			userAgent: "octo/0.1.0",
		});
		expect(await embedder.embed([])).toEqual([]);
		vi.unstubAllGlobals();
	});
});
