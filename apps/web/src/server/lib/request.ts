export function newRequestId(request: Request): string {
	const existing = request.headers.get("X-Request-Id")?.trim() ?? "";
	if (existing.length > 0 && existing.length <= 128) {
		return existing;
	}
	return crypto.randomUUID();
}

export function withOctoHeaders(response: Response, requestId: string, version: string): Response {
	const headers = new Headers(response.headers);
	headers.set("X-Request-Id", requestId);
	headers.set("X-Octo-Version", version);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
