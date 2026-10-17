export interface RequestOptions {
	method?: string;
	json?: unknown;
	body?: BodyInit;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface AdminClient {
	request<Result>(path: string, options?: RequestOptions): Promise<Result>;
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
	) {
		super(code);
	}
}

export const adminApi: AdminClient = {
	async request<Result>(path: string, options: RequestOptions = {}): Promise<Result> {
		if (
			!path.startsWith("/") ||
			path.startsWith("//") ||
			/[\\#]|%5c/i.test(path.split("?")[0] ?? "") ||
			path.includes("#") ||
			!new URL(`/api/admin${path}`, "https://admin.invalid").pathname.startsWith("/api/admin/")
		) {
			throw new Error("Invalid admin path");
		}
		const headers = new Headers(options.headers);
		if (options.json !== undefined) headers.set("Content-Type", "application/json");
		const response = await fetch(`/api/admin${path}`, {
			method: options.method ?? "GET",
			headers,
			credentials: "same-origin",
			redirect: "error",
			cache: "no-store",
			...(options.signal ? { signal: options.signal } : {}),
			...(options.json !== undefined
				? { body: JSON.stringify(options.json) }
				: options.body !== undefined
					? { body: options.body }
					: {}),
		});
		if (response.status === 204) return undefined as Result;
		const payload = (await response.json().catch(() => null)) as {
			error?: { code?: string };
		} | null;
		if (!response.ok || payload === null) {
			throw new ApiError(
				response.status,
				payload?.error?.code ??
					(response.status === 401 || response.status === 403 ? "access_denied" : "request_failed"),
			);
		}
		return payload as Result;
	},
};
