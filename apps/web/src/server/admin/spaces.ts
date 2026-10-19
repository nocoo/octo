import { z } from "zod";
import { spaceManagementCreateSchema, spaceSlugSchema } from "../../lib/schema/space-management";

export { createSpace, deleteSpace, updateSpace, validateOwner } from "../services/space-management";
export { spaceSlugSchema };

export const spaceCreateSchema = spaceManagementCreateSchema.extend({
	owner_key_id: z.string().min(1).nullable().default(null),
});
export const spacePatchSchema = z
	.strictObject({
		...spaceManagementCreateSchema.shape,
		description: z.string().max(10000),
		owner_key_id: z.string().min(1).nullable(),
	})
	.partial()
	.refine((input) => Object.keys(input).length > 0);
