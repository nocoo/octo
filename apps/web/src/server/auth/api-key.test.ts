import { describe, expect, it } from "vitest";
import {
	type ApiKeyRow,
	encodeBase32,
	generateApiKeyMaterial,
	hashSecret,
	KEYID_LENGTH,
	lookupApiKey,
	MAX_GRACE_MS,
	mintApiKey,
	parseApiKey,
	revokeApiKey,
	rotateApiKey,
	SECRET_LENGTH,
	secretsMatch,
	timingSafeEqual,
	touchLastUsed,
} from "./api-key";

type Stored = ApiKeyRow;

function keyDb(): { db: D1Database; rows: Map<string, Stored> } {
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
					if (sql.includes("RETURNING") && sql.includes("prev_secret_hash = secret_hash")) {
						const id = String(stmt.binds[3]);
						const row = rows.get(id);
						if (!row) {
							return null;
						}
						const prev = row.secret_hash;
						row.secret_hash = String(stmt.binds[0]);
						row.prev_secret_hash = prev;
						row.prev_valid_until = Number(stmt.binds[1]);
						row.updated_at = Number(stmt.binds[2]);
						return { ...row } as T;
					}
					const id = String(stmt.binds[0]);
					return (rows.get(id) as T | undefined) ?? null;
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
					} else if (sql.includes("revoked_at")) {
						const id = String(stmt.binds[2]);
						const row = rows.get(id);
						if (row) {
							row.revoked_at = Number(stmt.binds[0]);
							row.updated_at = Number(stmt.binds[1]);
						}
					} else if (sql.includes("last_used_at")) {
						const id = String(stmt.binds[1]);
						const row = rows.get(id);
						if (row) {
							row.last_used_at = Number(stmt.binds[0]);
						}
					}
					return { success: true };
				},
			};
			return stmt;
		},
	} as unknown as D1Database;
	return { db, rows };
}

const pepper = "pepper";
const mintBase = {
	name: "kb-bot",
	role: "admin",
	ops: "r,w,u,d",
	scope: "all" as const,
};

describe("encodeBase32", () => {
	it("encodes RFC 4648 vectors without padding", () => {
		const enc = (s: string) => encodeBase32(new TextEncoder().encode(s));
		expect(enc("")).toBe("");
		expect(enc("f")).toBe("MY");
		expect(enc("fo")).toBe("MZXQ");
		expect(enc("foo")).toBe("MZXW6");
		expect(enc("foob")).toBe("MZXW6YQ");
		expect(enc("fooba")).toBe("MZXW6YTB");
		expect(enc("foobar")).toBe("MZXW6YTBOI");
	});
});

describe("generateApiKeyMaterial", () => {
	it("mints octo_<keyid>_<secret> with base32 lengths", () => {
		const material = generateApiKeyMaterial();
		expect(material.keyid).toMatch(/^[A-Z2-7]{12}$/);
		expect(material.secret).toMatch(/^[A-Z2-7]{52}$/);
		expect(material.plaintext).toBe(`octo_${material.keyid}_${material.secret}`);
		expect(material.keyid).toHaveLength(KEYID_LENGTH);
		expect(material.secret).toHaveLength(SECRET_LENGTH);
		const other = generateApiKeyMaterial();
		expect(other.plaintext).not.toBe(material.plaintext);
	});
});

describe("parseApiKey", () => {
	it("parses generated keys and uppercases the secret", () => {
		const material = generateApiKeyMaterial();
		expect(parseApiKey(material.plaintext)).toEqual({
			keyid: material.keyid,
			secret: material.secret,
		});
		const lower = `octo_${material.keyid.toLowerCase()}_${material.secret.toLowerCase()}`;
		expect(parseApiKey(lower)).toEqual({
			keyid: material.keyid,
			secret: material.secret,
		});
	});

	it("rejects malformed tokens", () => {
		expect(parseApiKey("")).toBeNull();
		expect(
			parseApiKey("Bearer octo_ABCDEFGHIJKL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(
			parseApiKey("octo_SHORT_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(parseApiKey("octo_ABCDEFGHIJKL_SHORT")).toBeNull();
		expect(
			parseApiKey("octa_ABCDEFGHIJKL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(
			parseApiKey("octo_ABCDEFGHIJK1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(
			parseApiKey("octo_ABCDEFGHIJKL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"),
		).toBeNull();
	});
});

describe("timingSafeEqual", () => {
	it("compares equal and unequal strings without leaking length via true", () => {
		expect(timingSafeEqual("abcd", "abcd")).toBe(true);
		expect(timingSafeEqual("abcd", "abce")).toBe(false);
		expect(timingSafeEqual("abcd", "abc")).toBe(false);
		expect(timingSafeEqual("ab", "abcd")).toBe(false);
		expect(timingSafeEqual("", "")).toBe(true);
		expect(timingSafeEqual("a", "")).toBe(false);
		expect(timingSafeEqual("", "a")).toBe(false);
	});
});

describe("hashSecret", () => {
	it("HMACs the secret with the pepper and compares in constant time", async () => {
		const hash = await hashSecret("pepper", "secret");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(await secretsMatch("pepper", "secret", hash)).toBe(true);
		expect(await secretsMatch("pepper", "other", hash)).toBe(false);
		expect(await secretsMatch("other", "secret", hash)).toBe(false);
		expect(await hashSecret("pepper", "secret")).toBe(hash);
	});
});

describe("mintApiKey", () => {
	it("stores the hmac and never the plaintext secret", async () => {
		const { db, rows } = keyDb();
		const minted = await mintApiKey(
			db,
			pepper,
			{
				...mintBase,
				spaceIds: ["sp1"],
				ownEntriesOnly: true,
				autoOwnSpace: true,
				expiresAt: 9,
			},
			100,
		);
		expect(minted.plaintext.startsWith("octo_")).toBe(true);
		expect(minted.plaintext.includes(minted.row.secret_hash)).toBe(false);
		const stored = rows.get(minted.row.id);
		expect(stored?.secret_hash).toBe(minted.row.secret_hash);
		expect(stored?.name).toBe("kb-bot");
		expect(stored?.space_ids_json).toBe('["sp1"]');
		expect(stored?.own_entries_only).toBe(1);
		expect(stored?.auto_own_space).toBe(1);
		expect(stored?.expires_at).toBe(9);
		expect(await lookupApiKey(db, pepper, minted.plaintext, 8)).toEqual(stored);
		const defaults = await mintApiKey(db, pepper, mintBase, 100);
		expect(rows.get(defaults.row.id)?.space_ids_json).toBe("[]");
		expect(rows.get(defaults.row.id)?.own_entries_only).toBe(0);
		expect(rows.get(defaults.row.id)?.expires_at).toBeNull();
	});
});

describe("rotateApiKey", () => {
	it("accepts the previous secret only inside the grace window", async () => {
		const { db } = keyDb();
		const minted = await mintApiKey(db, pepper, mintBase, 1_000);
		const rotated = await rotateApiKey(db, pepper, minted.row.id, 50, 1_010);
		expect(rotated.plaintext).not.toBe(minted.plaintext);
		expect(await lookupApiKey(db, pepper, rotated.plaintext, 1_020)).toMatchObject({
			id: minted.row.id,
		});
		expect(await lookupApiKey(db, pepper, minted.plaintext, 1_020)).toMatchObject({
			id: minted.row.id,
		});
		expect(await lookupApiKey(db, pepper, minted.plaintext, 1_060)).toBeNull();
		expect(await lookupApiKey(db, pepper, rotated.plaintext, 1_060)).toMatchObject({
			id: minted.row.id,
		});
		const zero = await rotateApiKey(db, pepper, minted.row.id, 0, 2_000);
		expect(await lookupApiKey(db, pepper, rotated.plaintext, 2_000)).toBeNull();
		expect(await lookupApiKey(db, pepper, zero.plaintext, 2_000)).toMatchObject({
			id: minted.row.id,
		});
	});

	it("rejects missing keys and out-of-range grace", async () => {
		const { db } = keyDb();
		await expect(rotateApiKey(db, pepper, "missing")).rejects.toThrow("not found");
		await expect(rotateApiKey(db, pepper, "x", -1)).rejects.toThrow("grace");
		await expect(rotateApiKey(db, pepper, "x", MAX_GRACE_MS + 1)).rejects.toThrow("grace");
	});

	it("does not revive a stale secret when two rotations interleave", async () => {
		const { db, rows } = keyDb();
		const minted = await mintApiKey(db, pepper, mintBase, 1_000);
		const s0 = minted.row.secret_hash;
		await Promise.all([
			rotateApiKey(db, pepper, minted.row.id, 0, 3_000),
			rotateApiKey(db, pepper, minted.row.id, 50, 3_001),
		]);
		const stored = rows.get(minted.row.id);
		expect(stored?.secret_hash).not.toBe(s0);
		expect(stored?.prev_secret_hash).not.toBe(s0);
		expect(await lookupApiKey(db, pepper, minted.plaintext, 3_010)).toBeNull();
	});
});

describe("revokeApiKey and lookupApiKey", () => {
	it("treats revoked, expired, and wrong secrets as missing", async () => {
		const { db } = keyDb();
		const minted = await mintApiKey(db, pepper, { ...mintBase, expiresAt: 5_000 }, 1_000);
		expect(await lookupApiKey(db, pepper, "not-a-key", 1_000)).toBeNull();
		expect(await lookupApiKey(db, pepper, minted.plaintext, 5_000)).toBeNull();
		expect(await lookupApiKey(db, pepper, minted.plaintext, 4_999)).toMatchObject({
			id: minted.row.id,
		});
		const other = generateApiKeyMaterial();
		expect(
			await lookupApiKey(db, pepper, `octo_${minted.row.id}_${other.secret}`, 1_000),
		).toBeNull();
		await revokeApiKey(db, minted.row.id, 2_000);
		expect(await lookupApiKey(db, pepper, minted.plaintext, 2_000)).toBeNull();
		await expect(revokeApiKey(db, "missing")).rejects.toThrow("not found");
	});

	it("updates last_used_at", async () => {
		const { db, rows } = keyDb();
		const minted = await mintApiKey(db, pepper, mintBase, 1);
		await touchLastUsed(db, minted.row.id, 42);
		expect(rows.get(minted.row.id)?.last_used_at).toBe(42);
	});
});
