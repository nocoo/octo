import { z } from "zod";

export const batchGetRequestSchema = z.strictObject({
	ids: z.array(z.string().min(1)).min(1).max(100),
});

export type BatchGetRequest = z.infer<typeof batchGetRequestSchema>;
