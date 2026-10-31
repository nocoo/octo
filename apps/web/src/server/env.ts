import type { ParsedUpload } from "./attachments/upload";
import type { ApiPrincipal } from "./auth/authorize";
import type { AuthorProfileFetcher } from "./lib/author-profile";
import type { ApiError } from "./lib/errors";

export type AppVars = {
	requestId: string;
	writeStatements: D1PreparedStatement[];
	vectorMemoryIds: string[];
	writeError: (error: unknown) => ApiError | undefined | Promise<ApiError | undefined>;
	requestHashBody: string;
	attachmentUpload: ParsedUpload;
	apiKey: ApiPrincipal;
	adminEmail: string;
	responseErrorCode: ErrorCode;
	mcpWrite: boolean;
	bulkCounts: { requested: number; succeeded: number; failed: number };
};

export interface Env extends CloudflareBindings {
	VEC?: Vectorize;
	API_KEY_PEPPER?: string;
	ATTACHMENT_URL_SECRET?: string;
	ATTACHMENT_URL_HOST?: string;
	OCTO_SETTINGS_KEY?: string;
	RESOURCE_ENV?: string;
	AUTHOR_PROFILE_FETCHER?: AuthorProfileFetcher;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
	ACCESS_JWKS_URL?: string;
	ACCESS_DEV_BYPASS_EMAIL?: string;
	OCTO_VECTOR_SYNC_CONCURRENCY?: string;
}

export const WORKER_BINDINGS = ["DB", "FILES", "ASSETS"] as const;

export type ResourceEnv = "development" | "test" | "production";

export function resourceEnv(value: string | undefined): ResourceEnv {
	if (value === "development" || value === "test") {
		return value;
	}
	return "production";
}

import type { ErrorCode } from "../lib/schema/errors";
