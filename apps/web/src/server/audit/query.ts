import { z } from "zod";
import { ApiError } from "../lib/errors";
import { parseStrict } from "../lib/validate";

export const daySchema = z.iso.date();
export const keyIdSchema = z.string().regex(/^[A-Z2-7]{12}$/);
export const pageFields = {
	limit: z
		.string()
		.regex(/^\d{1,3}$/)
		.default("50")
		.transform(Number)
		.pipe(z.number().int().min(1).max(200)),
	cursor: z.string().min(1).max(8192).optional(),
};

export function readQuery<T>(schema: z.ZodType<T>, query: Record<string, string[]>): T {
	const values: Record<string, string> = Object.create(null);
	for (const [name, entries] of Object.entries(query)) {
		if (entries.length !== 1) throw new ApiError("validation_failed", "invalid query");
		values[name] = entries[0] as string;
	}
	return parseStrict(schema, values);
}

export function validateRange(from: number | string | undefined, to: number | string | undefined) {
	if (from !== undefined && to !== undefined && from > to) {
		throw new ApiError("validation_failed", "invalid time range");
	}
}
