import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrationSqlForNode } from "../../../../../../scripts/sqlite-test";
import { encodeFloat32Vector } from "../../search/math";
import { CloudflareVectorStore } from "./cloudflare";
import { D1BruteForceVectorStore } from "./d1-brute-force";
import type { VectorStore } from "./types";

type Metadata = Record<string, string | number>;
const rows = Array.from({ length: 150 }, (_, i) => ({
	id: `m${i}`,
	vector: [1, i / 150],
	metadata: {
		space: i % 2 ? "hidden" : "visible",
		type: i % 3 ? "note" : "task",
		source: i % 5 ? "other" : "k",
		importance: i / 150,
		created: i,
		updated: i * 2,
		...(i % 2 ? {} : { event: i * 3 }),
	} as Metadata,
}));

function matches(metadata: Metadata, filter: VectorizeVectorMetadataFilter = {}): boolean {
	return Object.entries(filter).every(([field, expression]) => {
		const value = metadata[field];
		if (typeof expression !== "object" || expression === null) return value === expression;
		return Object.entries(expression).every(([op, expected]) => {
			if (op === "$in") return (expected as unknown[]).includes(value);
			if (op === "$eq") return value === expected;
			if (value === undefined) return false;
			if (op === "$gte") return value >= expected;
			if (op === "$lte") return value <= expected;
			throw new Error(`unsupported filter operator ${op}`);
		});
	});
}

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

function makeStore(kind: "cloudflare" | "d1"): VectorStore {
	if (kind === "cloudflare") {
		return new CloudflareVectorStore({
			query: vi.fn(async (vector: number[], options: VectorizeQueryOptions) => ({
				matches: rows
					.filter((row) => matches(row.metadata, options.filter))
					.map((row) => ({
						id: row.id,
						score:
							row.vector.reduce((sum, value, i) => sum + value * (vector[i] ?? 0), 0) /
							Math.hypot(...row.vector) /
							Math.hypot(...vector),
					}))
					.sort((a, b) => b.score - a.score)
					.slice(0, options.topK),
			})),
		} as never);
	}
	const sqlite = new DatabaseSync(":memory:");
	databases.push(sqlite);
	sqlite.exec(migrationSqlForNode(readFileSync("migrations/0001_core.sql", "utf8")));
	sqlite.exec(
		"INSERT INTO spaces VALUES ('visible','visible','Visible','',NULL,1,1), ('hidden','hidden','Hidden','',NULL,1,1)",
	);
	for (const row of rows) {
		const m = row.metadata;
		sqlite
			.prepare(
				`INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,event_time,content_hash,created_at,updated_at) VALUES (?,?,'t','b',?,?,?,?, 'hash',?,?)`,
			)
			.run(
				row.id,
				m.space as string,
				m.type as string,
				m.importance as number,
				m.source as string,
				m.event ?? null,
				m.created as number,
				m.updated as number,
			);
		sqlite
			.prepare(
				"INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at) VALUES (?,'te3-small-1536','model',2,?,'hash',1)",
			)
			.run(row.id, encodeFloat32Vector(row.vector));
	}
	const db = {
		prepare: (sql: string) => ({
			bind: (...values: SQLInputValue[]) => ({
				all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
			}),
		}),
	} as never;
	return new D1BruteForceVectorStore(db, "te3-small-1536", {
		clauses: ["m.deleted_at IS NULL"],
		binds: [],
	});
}

const filters: VectorizeVectorMetadataFilter[] = [
	{
		space: { $in: ["visible"] },
		type: { $in: ["note"] },
		source: { $in: ["k"] },
		importance: { $gte: 0.1, $lte: 0.9 },
		updated: { $gte: 10, $lte: 250 },
	},
	{ space: { $eq: "hidden" }, created: { $gte: 20, $lte: 40 } },
	{ event: { $gte: 60, $lte: 120 } },
	{ space: { $in: [] } },
];

describe.each(["cloudflare", "d1"] as const)("%s vector contract", (kind) => {
	it.each(filters)("applies field-object filters %j", async (filter) => {
		const expected = rows.filter((row) => matches(row.metadata, filter)).slice(0, 100);
		const hits = await makeStore(kind).query({
			vector: [1, 0],
			topK: 100,
			returnMetadata: false,
			filter,
		});
		expect(hits.map((hit) => hit.id)).toEqual(expected.map((row) => row.id));
		for (const [i, row] of expected.entries())
			expect(hits[i]?.score).toBeCloseTo(1 / Math.hypot(...row.vector), 6);
	});

	it.each([
		{ returnMetadata: true, cap: 50 },
		{ returnMetadata: false, cap: 100 },
	])("caps topK with metadata=$returnMetadata at $cap", async ({ returnMetadata, cap }) => {
		const hits = await makeStore(kind).query({ vector: [1, 0], topK: 200, returnMetadata });
		expect(hits).toHaveLength(cap);
		expect(hits.map((hit) => hit.id)).toEqual(rows.slice(0, cap).map((row) => row.id));
		expect(hits[0]?.score).toBeCloseTo(1, 6);
	});
});
