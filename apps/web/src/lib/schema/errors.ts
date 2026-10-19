import { z } from "zod";

export const ERROR_CODES = [
	"validation_failed",
	"vector_dimension_mismatch",
	"unauthenticated",
	"forbidden",
	"not_found",
	"version_conflict",
	"space_not_empty",
	"tag_conflict",
	"tag_in_use",
	"idempotency_conflict",
	"payload_too_large",
	"unsupported_media_type",
	"unprocessable",
	"internal",
	"unavailable",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
	validation_failed: 400,
	vector_dimension_mismatch: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	space_not_empty: 409,
	tag_conflict: 409,
	tag_in_use: 409,
	idempotency_conflict: 409,
	payload_too_large: 413,
	unsupported_media_type: 415,
	unprocessable: 422,
	internal: 500,
	unavailable: 503,
};
