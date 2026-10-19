import { z } from "zod";

export const memoryMoveSchema = z.strictObject({
	space: z.string().min(1).max(64),
	expected_version: z.number().int().nonnegative().optional(),
});

export const batchMoveSchema = z.strictObject({
	space: memoryMoveSchema.shape.space,
	items: z
		.array(
			z.strictObject({
				id: z.string().min(1).max(64),
				expected_version: memoryMoveSchema.shape.expected_version,
			}),
		)
		.min(1),
});

export type MemoryMove = z.infer<typeof memoryMoveSchema>;
