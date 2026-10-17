import { describe, expect, it, vi } from "vitest";
import { CloudflareVectorStore } from "./cloudflare";

describe("CloudflareVectorStore", () => {
	it("maps query options and caps topK", async () => {
		const query = vi.fn(async () => ({
			matches: [{ id: "m1", score: 0.9 }, { id: "m2" }],
		}));
		const store = new CloudflareVectorStore({ query } as never);
		const hits = await store.query({
			vector: [0.1, 0.2],
			topK: 200,
			returnMetadata: false,
			filter: { space: { $eq: "kb" } },
		});
		expect(query).toHaveBeenCalledWith([0.1, 0.2], {
			topK: 100,
			returnMetadata: false,
			filter: { space: { $eq: "kb" } },
		});
		expect(hits).toEqual([
			{ id: "m1", score: 0.9 },
			{ id: "m2", score: 0 },
		]);
	});

	it("omits filter when not provided", async () => {
		const query = vi.fn(async () => ({ matches: [] }));
		const store = new CloudflareVectorStore({ query } as never);
		await store.query({ vector: [1], topK: 5, returnMetadata: false });
		const call = query.mock.calls[0] as unknown as [
			unknown,
			{ topK?: number; returnMetadata?: boolean },
		];
		expect(call[1]).toEqual({ topK: 5, returnMetadata: false });
	});

	it("passes filters when metadata is enabled", async () => {
		const query = vi.fn(async () => ({ matches: [] }));
		const store = new CloudflareVectorStore({ query } as never);
		await store.query({
			vector: [1],
			topK: 10,
			returnMetadata: true,
			filter: { space: { $eq: "kb" } },
		});
		const call = query.mock.calls[0] as unknown as [unknown, { filter?: unknown }];
		expect(call[1].filter).toEqual({ space: { $eq: "kb" } });
	});

	it("caps metadata queries at 50", async () => {
		const query = vi.fn(async () => ({ matches: [] }));
		const store = new CloudflareVectorStore({ query } as never);
		await store.query({ vector: [1], topK: 80, returnMetadata: true });
		const call = query.mock.calls[0] as unknown as [unknown, { topK?: number }];
		expect(call[1].topK).toBe(50);
	});
});
