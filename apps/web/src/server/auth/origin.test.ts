import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import {
	ADMIN_ORIGIN_DEV,
	ADMIN_ORIGIN_PROD,
	allowedAdminOrigin,
	assertAdminWriteOrigin,
	isSafeMethod,
} from "./origin";

function env(resource?: string): Env {
	return {
		DB: {} as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("x")) } as unknown as Fetcher,
		...(resource ? { RESOURCE_ENV: resource } : {}),
	};
}

describe("admin origin", () => {
	it("allows safe methods and requires the env origin on writes", () => {
		expect(isSafeMethod("get")).toBe(true);
		expect(isSafeMethod("POST")).toBe(false);
		expect(allowedAdminOrigin(env())).toBe(ADMIN_ORIGIN_PROD);
		expect(allowedAdminOrigin(env("development"))).toBe(ADMIN_ORIGIN_DEV);
		assertAdminWriteOrigin(new Request("http://x/api/admin/x"), env());
		assertAdminWriteOrigin(
			new Request("http://x/api/admin/x", {
				method: "POST",
				headers: { Origin: ADMIN_ORIGIN_PROD },
			}),
			env(),
		);
		expect(() =>
			assertAdminWriteOrigin(
				new Request("http://x/api/admin/x", {
					method: "POST",
					headers: { Origin: ADMIN_ORIGIN_DEV },
				}),
				env(),
			),
		).toThrow(ApiError);
		assertAdminWriteOrigin(
			new Request("http://x/api/admin/x", {
				method: "DELETE",
				headers: { Origin: ADMIN_ORIGIN_DEV },
			}),
			env("development"),
		);
	});
});
