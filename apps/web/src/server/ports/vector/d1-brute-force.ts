import { d1Results } from "../../lib/d1";
import type { SqlFilter } from "../../search/filters-sql";
import { decodeFloat32Vector, dot, l2Normalize } from "../../search/math";
import { vectorFilterSql } from "./filter-sql";
import type { VectorQueryHit, VectorQueryInput, VectorStore } from "./types";
import { capVectorTopK } from "./types";

export type D1VectorRow = {
	memory_id: string;
	dim: number;
	vector: ArrayBuffer;
};

export class D1BruteForceVectorStore implements VectorStore {
	constructor(
		private readonly db: D1Database,
		private readonly profileId: string,
		private readonly baseFilter: SqlFilter,
	) {}

	async query(input: VectorQueryInput): Promise<VectorQueryHit[]> {
		const topK = capVectorTopK(input.topK, input.returnMetadata);
		const metadata = vectorFilterSql(input.filter);
		const clauses = [...this.baseFilter.clauses, ...metadata.clauses];
		const binds = [...this.baseFilter.binds, ...metadata.binds];
		const sql = `
SELECT mv.memory_id, mv.dim, mv.vector
FROM memory_vectors mv
JOIN memories m ON m.id = mv.memory_id
JOIN spaces s ON s.id = m.space_id
WHERE mv.profile_id = ?
AND ${clauses.join(" AND ")}
`;
		const rows = await this.db
			.prepare(sql)
			.bind(this.profileId, ...binds)
			.all<D1VectorRow>();
		const queryVector = l2Normalize(input.vector);
		const scored: VectorQueryHit[] = [];
		for (const row of d1Results(rows)) {
			if (row.dim !== queryVector.length) throw new Error("vector dimension mismatch");
			const values = l2Normalize(decodeFloat32Vector(row.vector, row.dim));
			scored.push({ id: row.memory_id, score: dot(queryVector, values) });
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK);
	}
}
