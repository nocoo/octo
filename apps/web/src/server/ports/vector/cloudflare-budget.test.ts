import { describe, expect, it, vi } from "vitest";
import { CloudflareVectorStore } from "./cloudflare";

type Metadata = Record<string, string | number>;
function matches(metadata: Metadata, filter: VectorizeVectorMetadataFilter): boolean {
	return Object.entries(filter).every(([field, expression]) => {
		if (typeof expression !== "object" || expression === null)
			return metadata[field] === expression;
		return Object.entries(expression).every(([op, value]) => {
			const actual = metadata[field];
			if (op === "$in") return (value as unknown[]).includes(actual);
			if (actual === undefined) return false;
			if (op === "$gte") return actual >= value;
			if (op === "$lte") return actual <= value;
			throw new Error(`unexpected operator ${op}`);
		});
	});
}

const spaces = Array.from({ length: 100 }, (_, i) => `project-${i}-knowledge-base`);
const sources = Array.from({ length: 100 }, (_, i) => `source-${i}-𠮷野-"\\\n`);
const types = Array.from({ length: 50 }, (_, i) => `type-${i}-配置部署-"\\\t`);
const filter: VectorizeVectorMetadataFilter = {
	space: { $in: spaces },
	source: { $in: sources },
	type: { $in: types },
	importance: { $gte: 0.2, $lte: 0.8 },
	updated: { $gte: 10, $lte: 90 },
};
const rows = Array.from({ length: 150 }, (_, i) => ({
	id: `m${i}`,
	score: i / 150,
	metadata: {
		space: spaces[i % 100] as string,
		source: sources[(i * 7) % 100] as string,
		type: types[(i * 3) % 50] as string,
		importance: 0.5,
		updated: 50,
	} as Metadata,
}));
const dataset = [
	...rows,
	{ ...rows[0], id: "m0", score: 0.99, metadata: { ...rows[149]?.metadata } as Metadata },
	...[
		{ space: "hidden" },
		{ source: "other" },
		{ type: "other" },
		{ importance: 0.1 },
		{ importance: 0.9 },
		{ updated: 9 },
		{ updated: 91 },
	].map((change, i) => ({
		id: `excluded${i}`,
		score: 1,
		metadata: { ...rows[0]?.metadata, ...change } as Metadata,
	})),
];

describe("Vectorize filter byte budget", () => {
	it.each([64, 65])("bounds total requests at 64 for %i required partitions", async (count) => {
		const values = Array.from({ length: count }, (_, i) => `${i}`.padEnd(1100, "x"));
		const query = vi.fn(async (_vector: number[], options: VectorizeQueryOptions) => {
			expect(new TextEncoder().encode(JSON.stringify(options.filter)).length).toBeLessThan(2048);
			expect(options.filter?.space).toEqual({ $in: ["visible"] });
			expect(options.topK).toBe(7);
			return { matches: [] };
		});
		const result = new CloudflareVectorStore({ query } as never).query({
			vector: [1],
			topK: 7,
			returnMetadata: false,
			filter: { space: { $in: ["visible"] }, source: { $in: values } },
		});
		if (count === 64) {
			await expect(result).resolves.toEqual([]);
			expect(query).toHaveBeenCalledTimes(64);
			expect(
				query.mock.calls.flatMap(
					([, options]) =>
						((options.filter as VectorizeVectorMetadataFilter).source as { $in: string[] }).$in,
				),
			).toEqual(values);
		} else {
			await expect(result).rejects.toMatchObject({ code: "unavailable" });
			expect(query).not.toHaveBeenCalled();
		}
	});

	it("halts Cartesian planning before outbound calls for 8 spaces by 100 sources by 50 types", async () => {
		let serializations = 0;
		const filter = {
			space: { $in: Array.from({ length: 8 }, (_, i) => `${i}`.padEnd(64, "s")) },
			source: { $in: Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(900, "k")) },
			type: { $in: Array.from({ length: 50 }, (_, i) => `${i}`.padEnd(900, "t")) },
		};
		const original = Object.keys(filter);
		Object.defineProperty(filter, "toJSON", {
			value(this: VectorizeVectorMetadataFilter) {
				serializations++;
				if (serializations > 256) throw new Error("unbounded partition planning");
				return Object.fromEntries(original.map((key) => [key, this[key]]));
			},
			enumerable: true,
		});
		const query = vi.fn(async () => ({ matches: [] }));
		await expect(
			new CloudflareVectorStore({ query } as never).query({
				vector: [1],
				topK: 100,
				returnMetadata: false,
				filter,
			}),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(query).not.toHaveBeenCalled();
		expect(serializations).toBeLessThanOrEqual(256);
	});
	it.each([
		{ topK: 7, returnMetadata: false, cap: 7 },
		{ topK: 500, returnMetadata: false, cap: 100 },
		{ topK: 500, returnMetadata: true, cap: 50 },
	])(
		"preserves conjunctions and global topK $cap with metadata=$returnMetadata",
		async ({ topK, returnMetadata, cap }) => {
			const query = vi.fn(async (vector: number[], options: VectorizeQueryOptions) => {
				expect(vector).toEqual([0.6, 0.8]);
				expect(options.topK).toBe(cap);
				expect(options.returnMetadata).toBe(returnMetadata);
				const emitted = options.filter as VectorizeVectorMetadataFilter;
				expect(new TextEncoder().encode(JSON.stringify(emitted)).length).toBeLessThan(2048);
				expect(Object.keys(emitted).sort()).toEqual(Object.keys(filter).sort());
				expect(emitted.importance).toEqual(filter.importance);
				expect(emitted.updated).toEqual(filter.updated);
				for (const field of ["space", "source", "type"]) {
					const values = (emitted[field] as { $in: string[] }).$in;
					expect(values.length).toBeGreaterThan(0);
					const original = (filter[field] as { $in: string[] }).$in;
					expect(values.every((value) => original.includes(value))).toBe(true);
				}
				return {
					matches: dataset
						.filter((row) => matches(row.metadata, emitted))
						.sort((a, b) => b.score - a.score)
						.slice(0, options.topK),
				};
			});
			const hits = await new CloudflareVectorStore({ query } as never).query({
				vector: [0.6, 0.8],
				filter,
				topK,
				returnMetadata,
			});
			const expected = new Map<string, number>();
			for (const row of dataset.filter((row) => matches(row.metadata, filter))) {
				expected.set(row.id, Math.max(expected.get(row.id) ?? -Infinity, row.score));
			}
			expect(hits).toEqual(
				[...expected]
					.map(([id, score]) => ({ id, score }))
					.sort((a, b) => b.score - a.score)
					.slice(0, cap),
			);
			expect(query.mock.calls.length).toBeGreaterThan(1);
			expect(query.mock.calls.length).toBeLessThanOrEqual(128);
			for (const row of dataset) {
				expect(
					query.mock.calls.some(([, options]) =>
						matches(row.metadata, options.filter as VectorizeVectorMetadataFilter),
					),
				).toBe(matches(row.metadata, filter));
			}
		},
	);

	it("keeps the best duplicate score before applying the global limit", async () => {
		const query = vi.fn(async () => ({
			matches: [
				{ id: "first", score: 0.9 },
				{ id: "first", score: 0.2 },
				{ id: "second", score: 0.8 },
			],
		}));
		expect(
			await new CloudflareVectorStore({ query } as never).query({
				vector: [1],
				topK: 2,
				returnMetadata: false,
			}),
		).toEqual([
			{ id: "first", score: 0.9 },
			{ id: "second", score: 0.8 },
		]);
	});

	it.each([2047, 2048])("enforces the strict boundary for a %i-byte singleton", async (size) => {
		const empty = { space: { $in: [""] } };
		const overhead = new TextEncoder().encode(JSON.stringify(empty)).length;
		const singleton = { space: { $in: ["x".repeat(size - overhead)] } };
		const query = vi.fn(async () => ({ matches: [] }));
		const result = new CloudflareVectorStore({ query } as never).query({
			vector: [1],
			filter: singleton,
			topK: 1,
			returnMetadata: false,
		});
		if (size === 2047) {
			await expect(result).resolves.toEqual([]);
			expect(query).toHaveBeenCalledTimes(1);
		} else {
			await expect(result).rejects.toMatchObject({ code: "unavailable" });
			expect(query).not.toHaveBeenCalled();
		}
	});

	it("fails closed before any request if a later singleton cannot fit", async () => {
		const query = vi.fn(async () => ({ matches: [] }));
		await expect(
			new CloudflareVectorStore({ query } as never).query({
				vector: [1],
				topK: 1,
				returnMetadata: false,
				filter: { space: { $in: ["allowed", "𠮷".repeat(600)] }, importance: { $gte: 0.2 } },
			}),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(query).not.toHaveBeenCalled();
	});
});
