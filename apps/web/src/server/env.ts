import type { ApiPrincipal } from "./auth/authorize";

export type AppVars = {
	requestId: string;
	writeStatements: D1PreparedStatement[];
	apiKey: ApiPrincipal;
	adminEmail: string;
};

export interface Env extends CloudflareBindings {
	API_KEY_PEPPER?: string;
	ATTACHMENT_URL_SECRET?: string;
	OCTO_SETTINGS_KEY?: string;
	RESOURCE_ENV?: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
	ACCESS_JWKS_URL?: string;
	ACCESS_DEV_BYPASS_EMAIL?: string;
}

export const WORKER_BINDINGS = ["DB", "FILES", "ASSETS"] as const;

export type ResourceEnv = "development" | "test" | "production";

export function resourceEnv(value: string | undefined): ResourceEnv {
	if (value === "development" || value === "test") {
		return value;
	}
	return "production";
}
