import { type ErrorCode, HTTP_STATUS_BY_CODE } from "../../lib/schema/errors";

export class ApiError extends Error {
	readonly status: number;
	readonly code: ErrorCode;
	readonly details: Record<string, unknown> | null;

	constructor(
		code: ErrorCode,
		message: string,
		details: Record<string, unknown> | null = null,
		status: number = HTTP_STATUS_BY_CODE[code],
	) {
		super(message);
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export type ErrorEnvelope = {
	error: {
		code: ErrorCode;
		message: string;
		details?: Record<string, unknown>;
		request_id: string;
	};
};

export function errorEnvelope(
	code: ErrorCode,
	message: string,
	requestId: string,
	details: Record<string, unknown> | null = null,
): ErrorEnvelope {
	const error: ErrorEnvelope["error"] = { code, message, request_id: requestId };
	if (details) {
		error.details = details;
	}
	return { error };
}

export function jsonError(
	code: ErrorCode,
	message: string,
	requestId: string,
	details: Record<string, unknown> | null = null,
	status: number = HTTP_STATUS_BY_CODE[code],
): Response {
	return new Response(JSON.stringify(errorEnvelope(code, message, requestId, details)), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function jsonOk(body: unknown, status = 200, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...headers,
		},
	});
}

export function toErrorResponse(err: unknown, requestId: string): Response {
	if (err instanceof ApiError) {
		return jsonError(err.code, err.message, requestId, err.details, err.status);
	}
	return jsonError("internal", "internal error", requestId);
}
