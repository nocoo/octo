import type { MemoryFilters } from "../../lib/schema/filters";
import { sqlInClause } from "./sql-in";
import { isoToMs } from "./time";

export type SqlFilter = {
	clauses: string[];
	binds: unknown[];
};

export function timeColumn(field: "created" | "updated" | "event"): string {
	if (field === "created") {
		return "m.created_at";
	}
	if (field === "event") {
		return "m.event_time";
	}
	return "m.updated_at";
}

export function buildMemoryFilterSql(
	filters: MemoryFilters | undefined,
	spaceIds: string[],
): SqlFilter {
	const clauses = ["m.deleted_at IS NULL"];
	const binds: unknown[] = [];
	if (spaceIds.length === 0) {
		clauses.push("1 = 0");
	} else {
		const spaceIn = sqlInClause("m.space_id", spaceIds);
		clauses.push(spaceIn.sql);
		binds.push(...spaceIn.binds);
	}
	if (!filters) {
		return { clauses, binds };
	}
	if (filters.types?.length) {
		clauses.push(`m.type IN (${filters.types.map(() => "?").join(", ")})`);
		binds.push(...filters.types);
	}
	if (filters.sources?.length) {
		const sourcesIn = sqlInClause("m.source_key_id", filters.sources);
		clauses.push(sourcesIn.sql);
		binds.push(...sourcesIn.binds);
	}
	if (filters.importance?.min !== undefined) {
		clauses.push("m.importance >= ?");
		binds.push(filters.importance.min);
	}
	if (filters.importance?.max !== undefined) {
		clauses.push("m.importance <= ?");
		binds.push(filters.importance.max);
	}
	if (filters.time) {
		const col = timeColumn(filters.time.field);
		if (filters.time.from) {
			clauses.push(`${col} >= ?`);
			binds.push(isoToMs(filters.time.from));
		}
		if (filters.time.to) {
			clauses.push(`${col} <= ?`);
			binds.push(isoToMs(filters.time.to));
		}
	}
	return { clauses, binds };
}

export function tagsAllExistsSql(tagIds: string[]): { sql: string; binds: string[] } {
	const binds = [...tagIds];
	const parts = tagIds.map(
		() => `EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = m.id AND mt.tag_id = ?)`,
	);
	return { sql: parts.join(" AND "), binds };
}

export function tagsAnyExistsSql(tagIds: string[]): { sql: string; binds: string[] } {
	return {
		sql: `EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = m.id AND mt.tag_id IN (${tagIds
			.map(() => "?")
			.join(", ")}))`,
		binds: [...tagIds],
	};
}
