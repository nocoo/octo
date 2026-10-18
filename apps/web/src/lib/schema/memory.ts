import { z } from "zod";
import { isoUtcDateTimeSchema } from "./time";

export const MEMORY_BODY_MAX_BYTES = 1_000_000;

export function utf8Bytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

const bodySchema = z.string().refine((value) => utf8Bytes(value) <= MEMORY_BODY_MAX_BYTES, {
	message: "body exceeds 1MB UTF-8",
});

export const MEMORY_TYPES = [
	"fact",
	"preference",
	"decision",
	"procedure",
	"event",
	"log",
	"note",
] as const;

export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export const memoryImportanceSchema = z
	.number()
	.min(0)
	.max(1)
	.describe("Memory importance from 0 to 1 (inclusive).");

export const memoryVectorSchema = z.strictObject({
	profile: z.string().min(1).max(64),
	values: z.array(z.number().finite()).min(1).max(1536),
});

export const memoryCreateSchema = z.strictObject({
	space: z.string().min(1).max(64),
	title: z.string().min(1).max(500),
	body: bodySchema,
	type: memoryTypeSchema,
	tags: z.array(z.string().min(1).max(64)).max(100),
	importance: memoryImportanceSchema.optional(),
	event_time: isoUtcDateTimeSchema.optional(),
	vector: memoryVectorSchema.optional(),
});

export const memoryPatchSchema = z
	.strictObject({
		space: z.string().min(1).max(64).optional(),
		title: z.string().min(1).max(500).optional(),
		body: bodySchema.optional(),
		type: memoryTypeSchema.optional(),
		tags: z.array(z.string().min(1).max(64)).max(100).optional(),
		importance: memoryImportanceSchema.optional(),
		event_time: isoUtcDateTimeSchema.nullable().optional(),
		vector: memoryVectorSchema.nullable().optional(),
		expected_version: z.number().int().positive().optional(),
	})
	.refine(
		(input) =>
			input.space !== undefined ||
			input.title !== undefined ||
			input.body !== undefined ||
			input.type !== undefined ||
			input.tags !== undefined ||
			input.importance !== undefined ||
			input.event_time !== undefined ||
			input.vector !== undefined,
		{ message: "patch requires at least one field" },
	);

const versionedPatchSchema = memoryPatchSchema.safeExtend({
	expected_version: z.number().int().positive(),
});
const memoryUpdateId = z.string().min(1).max(64);
export const memoryUpdateSchema = z.union([
	versionedPatchSchema.safeExtend({ id: memoryUpdateId }),
	z
		.strictObject({ id: memoryUpdateId, patch: versionedPatchSchema })
		.transform(({ id, patch }) => ({ id, ...patch })),
]);

export type MemoryCreate = z.infer<typeof memoryCreateSchema>;
export type MemoryPatch = z.infer<typeof memoryPatchSchema>;
