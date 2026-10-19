import { z } from "zod";

export const spaceSlugSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const spaceManagementCreateSchema = z.strictObject({
	slug: spaceSlugSchema,
	name: z.string().trim().min(1).max(256),
	description: z.string().max(10000).default(""),
});

export const spaceManagementPatchSchema = z
	.strictObject({
		name: spaceManagementCreateSchema.shape.name,
		description: spaceManagementCreateSchema.shape.description.removeDefault(),
	})
	.partial()
	.refine((input) => Object.values(input).some((value) => value !== undefined));
