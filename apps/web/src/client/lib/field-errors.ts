import { ApiError } from "./api";

export function issueFieldErrors<Field extends string>(
	issues: readonly { path: string | readonly PropertyKey[] }[],
	messages: Readonly<Record<Field, string>>,
): Partial<Record<Field, string>> {
	const errors: Partial<Record<Field, string>> = {};
	for (const issue of issues) {
		const field = typeof issue.path === "string" ? issue.path.split(".")[0] : issue.path[0];
		if (typeof field === "string" && Object.hasOwn(messages, field)) {
			errors[field as Field] = messages[field as Field];
		}
	}
	return errors;
}

export function apiFieldErrors<Field extends string>(
	error: unknown,
	messages: Readonly<Record<Field, string>>,
): Partial<Record<Field, string>> {
	if (!(error instanceof ApiError) || error.code !== "validation_failed") return {};
	return issueFieldErrors(error.details?.issues ?? [], messages);
}
