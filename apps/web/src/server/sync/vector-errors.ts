const SAFE_NAME = /^(Error|TypeError|RangeError|AbortError|TimeoutError)$/;
const SAFE_CODE = /^(VECTOR_(DELETE|UPSERT|INSERT|QUERY)_ERROR|ETIMEDOUT|ECONNRESET|ECONNREFUSED)$/;
const SAFE_MESSAGE =
	/^(?:VECTOR_(?:DELETE|UPSERT|INSERT|QUERY)_ERROR(?: \(code = \d{1,8}\))?:?\s*)?(?:internal server error|service unavailable|too many requests|rate limit exceeded|unauthorized|forbidden|request timed out|network error)?/i;

export function vectorErrorDetails(error: unknown) {
	const record = typeof error === "object" && error !== null ? error : {};
	const rawMessage =
		"message" in record && typeof record.message === "string" ? record.message : "";
	const prefix = SAFE_MESSAGE.exec(rawMessage)?.[0] ?? "";
	const message =
		`${prefix.trim().replace(/:$/, "")}${prefix.length < rawMessage.length ? " [redacted]" : ""}`.trim();
	const rawCode = "code" in record ? record.code : undefined;
	const code =
		typeof rawCode === "number" &&
		Number.isInteger(rawCode) &&
		rawCode >= 0 &&
		rawCode < 100_000_000
			? rawCode
			: typeof rawCode === "string" && SAFE_CODE.test(rawCode)
				? rawCode
				: null;
	return {
		name:
			error instanceof Error ? (SAFE_NAME.test(error.name) ? error.name : "Error") : "UnknownError",
		code,
		error_message: (message || "[redacted]").slice(0, 300),
	};
}
