import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { type ApiKeyRow, mintApiKey } from "./api-key";
import {
	authenticateBearer,
	enqueueWaitUntil,
	extractBearer,
	hydrateApiKey,
	parseSpaceIds,
} from "./bearer";

type Stored = ApiKeyRow;

function keyDb(owned: string[] = ["own-1"]): { db: D1Database; rows: Map<string, Stored> } {
	const rows = new Map<string, Stored>();
	const db = {
		prepare(sql: string) {
			const stmt = {
				binds: [] as unknown[],
				bind(...args: unknown[]) {
					stmt.binds = args;
					return stmt;
				},
				async first<T>() {
					return (rows.get(String(stmt.binds[0])) as T | undefined) ?? null;
				},
				async run() {
					if (sql.includes("INSERT INTO api_keys")) {
						const id = String(stmt.binds[0]);
						rows.set(id, {
							id,
							name: String(stmt.binds[1]),
							secret_hash: String(stmt.binds[2]),
							prev_secret_hash: null,
							prev_valid_until: null,
							role: String(stmt.binds[3]),
							ops: String(stmt.binds[4]),
							scope: stmt.binds[5] as Stored["scope"],
							space_ids_json: String(stmt.binds[6]),
							own_entries_only: Number(stmt.binds[7]),
							auto_own_space: Number(stmt.binds[8]),
							expires_at: (stmt.binds[9] as number | null) ?? null,
							revoked_at: null,
							last_used_at: null,
							created_at: Number(stmt.binds[10]),
							updated_at: Number(stmt.binds[11]),
						});
					} else if (sql.includes("last_used_at")) {
						const row = rows.get(String(stmt.binds[1]));
						if (row) {
							row.last_used_at = Number(stmt.binds[0]);
						}
					}
					return { success: true };
				},
				async all<T>() {
					if (sql.includes("FROM spaces")) {
						return { results: owned.map((id) => ({ id })) as T[] };
					}
					return { results: [] as T[] };
				},
			};
			return stmt;
		},
	} as unknown as D1Database;
	return { db, rows };
}

function envFor(db: D1Database, pepper?: string): Env {
	return {
		DB: db,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		...(pepper ? { API_KEY_PEPPER: pepper } : {}),
	};
}

describe("extractBearer and parseSpaceIds", () => {
	it("accepts a single Bearer token and parses space id arrays", () => {
		expect(extractBearer(null)).toBeNull();
		expect(extractBearer("Basic x")).toBeNull();
		expect(extractBearer("Bearer")).toBeNull();
		expect(extractBearer("Bearer a b")).toBeNull();
		expect(extractBearer("Bearer tok")).toBe("tok");
		expect(parseSpaceIds('["a","b"]')).toEqual(["a", "b"]);
		expect(parseSpaceIds("[1]")).toEqual([]);
		expect(parseSpaceIds("{")).toEqual([]);
		expect(parseSpaceIds('"x"')).toEqual([]);
	});
});

describe("authenticateBearer", () => {
	it("hydrates a valid key and touches last_used_at", async () => {
		const { db, rows } = keyDb(["space-own"]);
		const minted = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "project",
			ops: "r,w",
			scope: "own",
			spaceIds: ["listed"],
			ownEntriesOnly: true,
			autoOwnSpace: true,
			expiresAt: 9_000,
		});
		const tasks: Promise<unknown>[] = [];
		const principal = await authenticateBearer(
			new Request("http://127.0.0.1/api/v1/me", {
				headers: { Authorization: `Bearer ${minted.plaintext}` },
			}),
			envFor(db, "pepper"),
			(task) => {
				tasks.push(task);
			},
			1_000,
		);
		expect(principal).toMatchObject({
			id: minted.row.id,
			name: "bot",
			role: "project",
			ownEntriesOnly: true,
			autoOwnSpace: true,
			expiresAt: 9_000,
			ownedSpaceIds: ["space-own"],
			spaceIds: ["listed"],
		});
		expect([...principal.ops].sort()).toEqual(["r", "w"]);
		await Promise.all(tasks);
		expect(rows.get(minted.row.id)?.last_used_at).toBe(1_000);
		const hydrated = await hydrateApiKey(db, minted.row);
		expect(hydrated.ownedSpaceIds).toEqual(["space-own"]);
	});

	it("returns 401 unauthenticated for every failure", async () => {
		const { db } = keyDb();
		const minted = await mintApiKey(db, "pepper", {
			name: "bot",
			role: "admin",
			ops: "r",
			scope: "all",
		});
		const fail = async (req: Request, pepper?: string) => {
			try {
				await authenticateBearer(req, envFor(db, pepper));
				throw new Error("expected throw");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).code).toBe("unauthenticated");
			}
		};
		await fail(new Request("http://x/api/v1/me"), "pepper");
		await fail(
			new Request("http://x/api/v1/me", { headers: { Authorization: "Bearer nope" } }),
			"pepper",
		);
		await fail(
			new Request("http://x/api/v1/me", {
				headers: { Authorization: `Bearer ${minted.plaintext}` },
			}),
		);
		await fail(
			new Request("http://x/api/v1/me", {
				headers: { Authorization: `Bearer ${minted.plaintext}` },
			}),
			"pepper-wrong",
		);
	});
});

describe("enqueueWaitUntil", () => {
	it("uses waitUntil when present and swallows missing context", async () => {
		const seen: Promise<unknown>[] = [];
		enqueueWaitUntil(
			{ executionCtx: { waitUntil: (task) => seen.push(task) } },
			Promise.resolve("ok"),
		);
		expect(seen).toHaveLength(1);
		enqueueWaitUntil({}, Promise.resolve("ok"));
		enqueueWaitUntil(
			{
				get executionCtx(): { waitUntil(promise: Promise<unknown>): void } {
					throw new Error("missing");
				},
			},
			Promise.resolve("ok"),
		);
	});
});
