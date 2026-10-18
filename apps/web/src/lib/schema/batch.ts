import { z } from "zod";
import { memoryCreateSchema, memoryUpdateSchema } from "./memory";

export const BATCH_MAX_ITEMS = 100;

export const batchCreateBodySchema = z.strictObject({
	items: z.array(memoryCreateSchema).min(1),
});

export const batchUpdateBodySchema = z.strictObject({
	items: z.array(memoryUpdateSchema).min(1),
});

export const batchDeleteBodySchema = z.strictObject({
	ids: z.array(z.string().min(1).max(64)).min(1),
});

export type BatchCreateBody = z.infer<typeof batchCreateBodySchema>;
export type BatchUpdateBody = z.infer<typeof batchUpdateBodySchema>;
export type BatchDeleteBody = z.infer<typeof batchDeleteBodySchema>;
