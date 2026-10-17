import { z } from "zod";
import { isoUtcDateTimeSchema } from "./time";

export const timeFilterSchema = z.strictObject({
	field: z.enum(["created", "updated", "event"]),
	from: isoUtcDateTimeSchema.optional(),
	to: isoUtcDateTimeSchema.optional(),
});

export const importanceFilterSchema = z.strictObject({
	min: z.number().min(0).max(1).optional(),
	max: z.number().min(0).max(1).optional(),
});

export const memoryFiltersSchema = z.strictObject({
	spaces: z.array(z.string().min(1)).max(100).optional(),
	tags_all: z.array(z.string().min(1).max(64)).max(50).optional(),
	tags_any: z.array(z.string().min(1).max(64)).max(50).optional(),
	types: z.array(z.string().min(1)).max(50).optional(),
	sources: z.array(z.string().min(1)).max(100).optional(),
	time: timeFilterSchema.optional(),
	importance: importanceFilterSchema.optional(),
});

export type MemoryFilters = z.infer<typeof memoryFiltersSchema>;
