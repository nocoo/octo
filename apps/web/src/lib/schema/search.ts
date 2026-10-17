import { z } from "zod";
import { memoryFiltersSchema } from "./filters";
import { memoryVectorSchema } from "./memory";

export const searchFusionSchema = z.strictObject({
	method: z.enum(["rrf", "weighted"]),
	k: z.number().int().positive().max(200).optional(),
	weights: z
		.strictObject({
			fts: z.number().min(0),
			vector: z.number().min(0),
		})
		.optional(),
});

export const searchRequestSchema = z
	.strictObject({
		query: z.string().min(1).optional(),
		vector: memoryVectorSchema.optional(),
		filters: memoryFiltersSchema.optional(),
		mode: z.enum(["hybrid", "fts", "vector"]).optional(),
		fusion: searchFusionSchema.optional(),
		limit: z.number().int().min(1).max(200).optional(),
		include: z
			.array(z.enum(["snippet"]))
			.max(8)
			.optional(),
	})
	.refine((input) => input.query !== undefined || input.vector !== undefined, {
		message: "query or vector is required",
	});

export type SearchRequest = z.infer<typeof searchRequestSchema>;
