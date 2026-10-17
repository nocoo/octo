import type { SqlFilter } from "../../search/filters-sql";
import { sqlInClause } from "../../search/sql-in";

const columns: Record<string, string> = {
	space: "s.slug",
	type: "m.type",
	source: "m.source_key_id",
	importance: "m.importance",
	created: "m.created_at",
	updated: "m.updated_at",
	event: "m.event_time",
};
const operators: Record<string, string> = { $eq: "=", $gte: ">=", $lte: "<=" };

export function vectorFilterSql(filter: VectorizeVectorMetadataFilter = {}): SqlFilter {
	const clauses: string[] = [];
	const binds: unknown[] = [];
	for (const [field, expression] of Object.entries(filter)) {
		const column = columns[field];
		if (!column) throw new Error("unsupported vector filter field");
		const comparisons =
			typeof expression === "object" && expression !== null ? expression : { $eq: expression };
		for (const [operator, value] of Object.entries(comparisons)) {
			if (operator === "$in") {
				const set = sqlInClause(column, value as string[]);
				clauses.push(set.sql);
				binds.push(...set.binds);
			} else {
				const comparison = operators[operator];
				if (!comparison) throw new Error("unsupported vector filter operator");
				clauses.push(`${column} ${comparison} ?`);
				binds.push(value);
			}
		}
	}
	return { clauses, binds };
}
