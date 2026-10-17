import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { hmacSecretHash } from "./api-key";
import { resolveAuthz } from "./key-auth";

describe("resolveAuthz", () => {
	it("rejects revoked keys", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => ({
						id: "abcdefghijkl",
						secret_hash: "x",
						prev_secret_hash: null,
						prev_valid_until: null,
						scope: "all",
						space_ids_json: "[]",
						revoked_at: 1,
						expires_at: null,
						ops: "r",
					}),
				}),
			}),
		} as never;
		await expect(
			resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper"),
		).rejects.toMatchObject({ code: "unauthenticated" });
	});

	it("accepts a valid key", async () => {
		const hash = await hmacSecretHash("pepper", "secret");
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					first: async () => {
						if (sql.includes("api_keys")) {
							return {
								id: "abcdefghijkl",
								secret_hash: hash,
								prev_secret_hash: null,
								prev_valid_until: null,
								scope: "all",
								space_ids_json: "[]",
								revoked_at: null,
								expires_at: null,
								ops: "r,w",
							};
						}
						return null;
					},
					all: async () => ({ results: [] }),
				}),
			}),
		} as never;
		const authz = await resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper");
		expect(authz.visibleSpaceIds).toBe("all");
	});

	it("ignores expired prev secrets", async () => {
		const hash = await hmacSecretHash("pepper", "secret");
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => ({
						id: "abcdefghijkl",
						secret_hash: "deadbeef",
						prev_secret_hash: hash,
						prev_valid_until: Date.now() - 1,
						scope: "all",
						space_ids_json: "[]",
						revoked_at: null,
						expires_at: null,
						ops: "r",
					}),
				}),
			}),
		} as never;
		await expect(
			resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper"),
		).rejects.toMatchObject({ code: "unauthenticated" });
	});

	it("supports prev secret grace and scoped keys", async () => {
		const hash = await hmacSecretHash("pepper", "secret");
		const db = {
			prepare: (_sql: string) => ({
				bind: () => ({
					first: async () => ({
						id: "abcdefghijkl",
						secret_hash: "deadbeef",
						prev_secret_hash: hash,
						prev_valid_until: Date.now() + 60_000,
						scope: "spaces",
						space_ids_json: '["s1"]',
						revoked_at: null,
						expires_at: null,
						ops: "r",
					}),
					all: async () => ({ results: [] }),
				}),
			}),
		} as never;
		const authz = await resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper");
		expect(authz.visibleSpaceIds).toEqual(["s1"]);
	});

	it("rejects invalid secrets", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => ({
						id: "abcdefghijkl",
						secret_hash: "deadbeef",
						prev_secret_hash: null,
						prev_valid_until: null,
						scope: "all",
						space_ids_json: "[]",
						revoked_at: null,
						expires_at: null,
						ops: "r",
					}),
				}),
			}),
		} as never;
		await expect(
			resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper"),
		).rejects.toBeInstanceOf(ApiError);
	});

	it("rejects missing read permission and expired keys", async () => {
		const hash = await hmacSecretHash("pepper", "secret");
		const row: {
			id: string;
			secret_hash: string;
			prev_secret_hash: string | null;
			prev_valid_until: number | null;
			scope: string;
			space_ids_json: string;
			revoked_at: number | null;
			expires_at: number | null;
			ops: string;
		} = {
			id: "abcdefghijkl",
			secret_hash: hash,
			prev_secret_hash: null,
			prev_valid_until: null,
			scope: "all",
			space_ids_json: "[]",
			revoked_at: null,
			expires_at: Date.now() - 1,
			ops: "r",
		};
		const db = {
			prepare: () => ({
				bind: () => ({
					first: async () => row,
					all: async () => ({ results: [{ id: "s9" }] }),
				}),
			}),
		} as never;
		await expect(
			resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper"),
		).rejects.toMatchObject({ code: "unauthenticated" });
		row.expires_at = null;
		row.ops = "w";
		await expect(
			resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper"),
		).rejects.toMatchObject({ code: "forbidden" });
		row.ops = "r";
		row.scope = "own";
		const authz = await resolveAuthz(db, { keyId: "abcdefghijkl", secret: "secret" }, "pepper");
		expect(authz.visibleSpaceIds).toEqual(["s9"]);
	});
});
