import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayEmbedder } from "./gateway";

const config = {
	baseUrl: "https://gateway.example/v1",
	apiKey: "private-test-key",
	model: "m",
	dims: 2,
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("safe gateway failure categories", () => {
	it.each([401, 403, 429, 500])("classifies HTTP %i without reading its body", async (status) => {
		const response = new Response("private-upstream-body", { status });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response),
		);
		await expect(new GatewayEmbedder(config).embed(["private-input"])).rejects.toMatchObject({
			reason: { stage: "status", upstream_status: status },
		});
		expect(response.bodyUsed).toBe(false);
	});

	it.each([301, 302, 307, 308])("classifies redirect %i without following it", async (status) => {
		const response = new Response("private-upstream-body", {
			status,
			headers: { Location: "https://private.example/private-key" },
		});
		const fetcher = vi.fn(async () => response);
		vi.stubGlobal("fetch", fetcher);
		await expect(new GatewayEmbedder(config).embed(["private-input"])).rejects.toMatchObject({
			reason: { stage: "redirect", upstream_status: status },
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher.mock.calls[0]).toEqual([
			expect.any(String),
			expect.objectContaining({ redirect: "manual" }),
		]);
		expect(response.bodyUsed).toBe(false);
	});

	it("replaces request exceptions with static safe metadata", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("private-test-key private-input");
			}),
		);
		const error = await new GatewayEmbedder(config)
			.embed(["private-input"])
			.catch((failure: unknown) => failure);
		expect(error).toMatchObject({ reason: { stage: "request" } });
		expect(String(error)).not.toContain("private");
		expect(JSON.stringify(error)).not.toContain("private");
	});

	it.each([
		"invalid-json",
		"null",
		"{}",
		'{"data":[null]}',
		'{"data":[{"embedding":["private",0]}]}',
		'{"data":[{"embedding":[0,0]}]}',
	])("classifies malformed response %s", async (body) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body)),
		);
		await expect(new GatewayEmbedder(config).embed(["private-input"])).rejects.toMatchObject({
			reason: { stage: "parse" },
		});
	});

	it("retains safe dimension metadata", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1] }] })),
		);
		await expect(new GatewayEmbedder(config).embed(["private-input"])).rejects.toMatchObject({
			reason: { stage: "dims" },
			actualDims: 1,
			code: "vector_dimension_mismatch",
		});
	});

	it.each(["request", "body"])(
		"classifies timeout during %s and clears its timer",
		async (phase) => {
			vi.useFakeTimers();
			vi.stubGlobal(
				"fetch",
				vi.fn(async (_url: string, init: RequestInit) => {
					const pending = new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener("abort", () => reject(new Error("private-abort-detail")));
					});
					if (phase === "request") return pending;
					return { ok: true, json: () => pending };
				}),
			);
			const pending = new GatewayEmbedder({ ...config, timeoutMs: 25 })
				.embed(["private-input"])
				.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(25);
			expect(await pending).toMatchObject({ reason: { stage: "timeout" } });
			expect(vi.getTimerCount()).toBe(0);
		},
	);
});
