import { z } from "zod";
import { errorCodeSchema } from "../../lib/schema/errors";
import {
	memoryImportanceSchema,
	memoryTypeSchema,
	memoryUpdateSchema,
} from "../../lib/schema/memory";

const id = z.string().min(1);
const timestamp = z.string();
const record = z.record(z.string(), z.unknown());
export const errorOutput = z.object({
	error: z.object({
		code: errorCodeSchema,
		message: z.string(),
		request_id: z.string(),
		details: record.optional(),
	}),
});
const summaryFields = {
	id,
	space: z.string(),
	title: z.string(),
	body: z.string(),
	type: memoryTypeSchema,
	tags: z.array(z.string()),
	importance: memoryImportanceSchema,
	event_time: timestamp.nullable(),
	created_at: timestamp,
	updated_at: timestamp,
};
const summary = z.object(summaryFields);

export const memoryOutput = z.looseObject({
	...summaryFields,
	version: z.number().int(),
	content_hash: z.string(),
	source_key_id: z.string().nullable(),
	updated_by_key_id: z.string().nullable(),
});

export const searchOutput = z.object({
	items: z.array(z.object({ ...summaryFields, scores: record, snippet: z.string().optional() })),
	channels: z.object({
		fts: z.object({
			candidates: z.number().int(),
			partial: z.boolean(),
			partial_reason: z.null(),
		}),
		vector: z.object({
			candidates: z.number().int(),
			truncated: z.boolean(),
			profile: z.string().nullable(),
		}),
	}),
});

export const batchGetOutput = z.object({ items: z.array(summary), missing: z.array(z.string()) });
export const deleteOutput = z.object({ trashed_at: timestamp });
export const changesOutput = z.object({
	items: z.array(
		z.object({
			seq: z.number().int(),
			entity: z.string(),
			entity_id: z.string(),
			op: z.string(),
			at: timestamp,
			space_id: z.string().nullable().optional(),
			version: z.number().int().nullable().optional(),
			actor: z.string().optional(),
		}),
	),
	next_cursor: z.string().nullable(),
});
export const tagsOutput = z.object({
	items: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			display_name: z.string(),
			use_count: z.number().int(),
		}),
	),
	next_cursor: z.null(),
});
export const spacesOutput = z.object({
	items: z.array(
		z.object({
			id: z.string(),
			slug: z.string(),
			name: z.string(),
			description: z.string(),
			owner_key_id: z.string().nullable(),
			memory_count: z.number().int(),
			created_at: timestamp,
			updated_at: timestamp,
		}),
	),
	next_cursor: z.null(),
});

export const idInput = z.strictObject({ id });
export const getInput = z.strictObject({
	id,
	include: z
		.array(z.enum(["trashed", "versions_count", "attachments", "vector_status"]))
		.optional(),
});
export const updateInput = memoryUpdateSchema;
export const changesInput = z.strictObject({
	cursor: z.string().min(1).optional(),
	limit: z.number().int().min(1).max(200).optional(),
	spaces: z.array(z.string().min(1)).optional(),
});
export const emptyInput = z.strictObject({});
