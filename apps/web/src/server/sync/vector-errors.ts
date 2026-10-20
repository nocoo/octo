const SAFE_NAME = /^(Error|TypeError|RangeError|AbortError|TimeoutError)$/;
const SAFE_CODE = /^(VECTOR_(DELETE|UPSERT|INSERT|QUERY)_ERROR|ETIMEDOUT|ECONNRESET|ECONNREFUSED)$/;
const SAFE_MESSAGE =
	/^(?:VECTOR_(?:DELETE|UPSERT|INSERT|QUERY)_ERROR(?: \(code = \d{1,8}\))?:?\s*)?(?:internal server error|service unavailable|too many requests|rate limit exceeded|unauthorized|forbidden|request timed out|network error)?/i;

export function isVectorRateLimit(error: unknown): boolean {
	const record = typeof error === "object" && error !== null ? error : {};
	if ("code" in record && [40041, "40041", 429, "429"].includes(record.code as number | string))
		return true;
	if ("status" in record && record.status === 429) return true;
	if ("statusCode" in record && record.statusCode === 429) return true;
	const message = typeof error === "string" ? error : "message" in record ? record.message : "";
	return (
		typeof message === "string" &&
		/\b40041\b|\b429\b|too many requests|rate[\s_-]*limit/i.test(message)
	);
}

export async function retryVectorMutation(operation: () => Promise<void>): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await operation();
			return;
		} catch (error) {
			if (attempt === 2 || !isVectorRateLimit(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt * (1 + Math.random())));
		}
	}
}

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
