import { createTwoFilesPatch, structuredPatch } from "diff";

export type VersionRow = {
	memory_id: string;
	version: number;
	title: string;
	body: string;
	type: string;
	importance: number;
	tags_json: string;
	event_time: number | null;
	space_id: string;
	actor: string;
	op: string;
	rollback_of: number | null;
	created_at: number;
};

export type VersionMeta = Omit<VersionRow, "body">;

export type FieldDiff = {
	field: string;
	from: unknown;
	to: unknown;
};

export type VersionDiff = {
	from: number;
	to: number;
	fields: FieldDiff[];
	body: {
		unified: string;
		hunks: Array<{
			oldStart: number;
			oldLines: number;
			newStart: number;
			newLines: number;
			lines: string[];
		}>;
	};
};

export class VersionRepo {
	constructor(private readonly db: D1Database) {}

	async list(memoryId: string): Promise<VersionMeta[]> {
		const { results } = await this.db
			.prepare(
				"SELECT memory_id, version, title, type, importance, tags_json, event_time, space_id, actor, op, rollback_of, created_at FROM memory_versions WHERE memory_id = ? ORDER BY version",
			)
			.bind(memoryId)
			.all<VersionMeta>();
		return results;
	}

	async get(memoryId: string, version: number): Promise<VersionRow | null> {
		return this.db
			.prepare("SELECT * FROM memory_versions WHERE memory_id = ? AND version = ?")
			.bind(memoryId, version)
			.first<VersionRow>();
	}
}

function parseTags(json: string): string[] {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
			return [];
		}
		return parsed;
	} catch {
		return [];
	}
}

export function diffVersions(from: VersionRow, to: VersionRow): VersionDiff {
	const fields: FieldDiff[] = [];
	const scalar: Array<
		keyof Pick<VersionRow, "title" | "type" | "importance" | "event_time" | "space_id">
	> = ["title", "type", "importance", "event_time", "space_id"];
	for (const field of scalar) {
		if (from[field] !== to[field]) {
			fields.push({ field, from: from[field], to: to[field] });
		}
	}
	const fromTags = parseTags(from.tags_json);
	const toTags = parseTags(to.tags_json);
	if (JSON.stringify(fromTags) !== JSON.stringify(toTags)) {
		fields.push({ field: "tags", from: fromTags, to: toTags });
	}
	if (from.body !== to.body) {
		fields.push({ field: "body", from: from.body, to: to.body });
	}
	const patch = structuredPatch("body", "body", from.body, to.body, undefined, undefined, {
		context: 3,
	});
	return {
		from: from.version,
		to: to.version,
		fields,
		body: {
			unified: createTwoFilesPatch("body", "body", from.body, to.body),
			hunks: patch.hunks,
		},
	};
}
