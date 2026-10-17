import type { ZodType } from "zod";
import { ApiError } from "./errors";

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new ApiError("validation_failed", "invalid json");
	}
}

export function parseStrict<T>(schema: ZodType<T>, data: unknown): T {
	const result = schema.safeParse(data);
	if (result.success) {
		return result.data;
	}
	throw new ApiError("validation_failed", "schema validation failed", {
		issues: result.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		})),
	});
}
