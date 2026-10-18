import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayEmbedder } from "./gateway";

const config = { baseUrl: "http://127.0.0.1:9/", apiKey: "k", model: "m", dims: 2 };
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("GatewayEmbedder", () => {
	it.each([
		["https://gateway.example", "https://gateway.example/v1/embeddings"],
		["https://gateway.example/v1", "https://gateway.example/v1/embeddings"],
		["https://gateway.example/v1///", "https://gateway.example/v1/embeddings"],
		["https://gateway.example/proxy/v1/", "https://gateway.example/proxy/v1/embeddings"],
		["https://gateway.example/proxy", "https://gateway.example/proxy/v1/embeddings"],
	])("normalizes API base %s without duplicating v1", async (baseUrl, endpoint) => {
		const fetcher = vi.fn(async () => Response.json({ data: [{ embedding: [1, 0] }] }));
		vi.stubGlobal("fetch", fetcher);
		await new GatewayEmbedder({ ...config, baseUrl }).embed(["fixed"]);
		expect(fetcher).toHaveBeenCalledWith(endpoint, expect.any(Object));
	});

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

	it.each([300, 301, 302, 303, 304, 305, 307, 308, 399])(
		"rejects status %i without following Location or reading its body",
		async (status) => {
			const response = new Response(status === 304 ? null : "untrusted upstream body", {
				status,
				headers: { Location: "https://untrusted.example/private" },
			});
			const readBody = vi.spyOn(response, "json");
			const fetcher = vi.fn(async (_input: RequestInfo, init: RequestInit) => {
				expect(init.redirect).toBe("manual");
				return response;
			});
			vi.stubGlobal("fetch", fetcher);
			await expect(new GatewayEmbedder(config).embed(["fixed"])).rejects.toEqual(
				new Error(`embedder status ${status}`),
			);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://127.0.0.1:9/v1/embeddings");
			expect(readBody).not.toHaveBeenCalled();
			expect(response.bodyUsed).toBe(false);
		},
	);

	it("rejects a missing embedding", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{}] })),
		);
		await expect(new GatewayEmbedder(config).embed(["x"])).rejects.toThrow("invalid embedding");
	});

	it.each([
		{ name: "object with malicious length", embedding: { length: { credential: "fake" } } },
		{ name: "array-like object", embedding: { 0: 1, 1: 0, length: 2 } },
		{ name: "string", embedding: "fake-credential" },
		{ name: "null", embedding: null },
		{ name: "number", embedding: 2 },
	])("rejects $name before reading dimension metadata", async ({ embedding }) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding }] })),
		);
		await expect(new GatewayEmbedder(config).embed(["fixed"])).rejects.toEqual(
			new Error("invalid embedding"),
		);
	});

	it("rejects a null embedding row with the same static error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [null] })),
		);
		await expect(new GatewayEmbedder(config).embed(["fixed"])).rejects.toEqual(
			new Error("invalid embedding"),
		);
	});

	it.each([
		{ name: "missing", body: {} },
		{ name: "non-array object", body: { data: {} } },
		{ name: "non-array string", body: { data: "invalid" } },
		{ name: "null", body: { data: null } },
		{ name: "empty", body: { data: [] } },
		{ name: "fewer", body: { data: [{ embedding: [3, 4] }] } },
		{
			name: "extra",
			body: { data: [{ embedding: [3, 4] }, { embedding: [3, 4] }, { embedding: [3, 4] }] },
		},
	])("rejects $name embeddings for nonempty input", async ({ body }) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(body)),
		);
		await expect(new GatewayEmbedder(config).embed(["hello", "world"])).rejects.toThrow(
			"embedding count mismatch",
		);
	});

	it("normalizes one embedding per input", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [3, 4] }, { embedding: [4, 3] }] })),
		);
		expect(await new GatewayEmbedder(config).embed(["hello", "world"])).toEqual([
			[0.6, 0.8],
			[0.8, 0.6],
		]);
	});

	it("returns an empty array without calling the gateway for empty input", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await new GatewayEmbedder(config).embed([])).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

it("blocks credential-bearing redirects and exposes only safe dimension metadata", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_input: RequestInfo, init: RequestInit) => {
			expect(init.redirect).toBe("manual");
			expect(new Headers(init.headers).get("User-Agent")).toMatch(/^octo\//);
			return Response.json({ data: [{ embedding: [1, 2, 3] }] });
		}),
	);
	await expect(new GatewayEmbedder(config).embed(["fixed"])).rejects.toMatchObject({
		code: "vector_dimension_mismatch",
		actualDims: 3,
	});
});
