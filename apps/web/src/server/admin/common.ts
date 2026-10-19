import type { Context } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";

export function adminActor(context: Context<{ Bindings: Env; Variables: AppVars }>): string {
	const email = context.get("adminEmail");
	if (!email) throw new ApiError("unauthenticated", "unauthenticated");
	return `admin:${email}`;
}

export function conflict(message: string): ApiError {
	return new ApiError("version_conflict", message);
}
