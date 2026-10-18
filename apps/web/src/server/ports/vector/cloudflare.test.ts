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
			returnMetadata: "none",
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
		expect(query.mock.calls).toEqual([[[1], { topK: 5, returnMetadata: "none" }]]);
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
		expect(query.mock.calls).toEqual([
			[[1], { topK: 10, returnMetadata: "all", filter: { space: { $eq: "kb" } } }],
		]);
	});

	it("caps metadata queries at 50", async () => {
		const query = vi.fn(async () => ({ matches: [] }));
		const store = new CloudflareVectorStore({ query } as never);
		await store.query({ vector: [1], topK: 80, returnMetadata: true });
		expect(query.mock.calls).toEqual([[[1], { topK: 50, returnMetadata: "all" }]]);
	});

	it.each([
		{ returnMetadata: false, metadataLevel: "none", topK: 100 },
		{ returnMetadata: true, metadataLevel: "all", topK: 50 },
	])(
		"maps every partition with metadata=$returnMetadata",
		async ({ returnMetadata, metadataLevel, topK }) => {
			const query = vi.fn(async () => ({ matches: [] }));
			const sources = ["first".padEnd(1100, "x"), "second".padEnd(1100, "x")];
			await new CloudflareVectorStore({ query } as never).query({
				vector: [1],
				topK: 200,
				returnMetadata,
				filter: { space: { $eq: "kb" }, source: { $in: sources } },
			});
			expect(query.mock.calls).toEqual(
				sources.map((source) => [
					[1],
					{
						topK,
						returnMetadata: metadataLevel,
						filter: { space: { $eq: "kb" }, source: { $in: [source] } },
					},
				]),
			);
		},
	);
});
