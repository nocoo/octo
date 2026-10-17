export type AppVars = {
	requestId: string;
};

export interface Env extends CloudflareBindings {
	API_KEY_PEPPER?: string;
	ATTACHMENT_URL_SECRET?: string;
	OCTO_SETTINGS_KEY?: string;
}

export const WORKER_BINDINGS = ["DB", "FILES", "ASSETS"] as const;
