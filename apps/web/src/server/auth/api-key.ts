const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const KEYID_LENGTH = 12;
export const SECRET_BYTES = 32;
export const SECRET_LENGTH = 52;
export const MAX_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			const index = (value >>> bits) & 31;
			out += BASE32.charAt(index);
		}
	}
	if (bits > 0) {
		const index = (value << (5 - bits)) & 31;
		out += BASE32.charAt(index);
	}
	return out;
}

export function generateApiKeyMaterial(): { keyid: string; secret: string; plaintext: string } {
	const keyidBytes = new Uint8Array(8);
	const secretBytes = new Uint8Array(SECRET_BYTES);
	crypto.getRandomValues(keyidBytes);
	crypto.getRandomValues(secretBytes);
	const keyid = encodeBase32(keyidBytes).slice(0, KEYID_LENGTH);
	const secret = encodeBase32(secretBytes);
	return { keyid, secret, plaintext: `octo_${keyid}_${secret}` };
}

const TOKEN_RE = /^octo_([A-Za-z2-7]{12})_([A-Za-z2-7]{52})$/;

export function parseApiKey(token: string): { keyid: string; secret: string } | null {
	const match = TOKEN_RE.exec(token);
	if (!match?.[1] || !match[2]) {
		return null;
	}
	return { keyid: match[1].toUpperCase(), secret: match[2].toUpperCase() };
}

export function timingSafeEqual(left: string, right: string): boolean {
	const a = new TextEncoder().encode(left);
	const b = new TextEncoder().encode(right);
	const n = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < n; i += 1) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}
	return diff === 0;
}

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

export async function hashSecret(pepper: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret));
	return hex(new Uint8Array(sig));
}

export async function secretsMatch(pepper: string, secret: string, hash: string): Promise<boolean> {
	return timingSafeEqual(await hashSecret(pepper, secret), hash);
}

export type ApiKeyScope = "all" | "spaces" | "own";

export type ApiKeyRow = {
	id: string;
	name: string;
	secret_hash: string;
	prev_secret_hash: string | null;
	prev_valid_until: number | null;
	role: string;
	ops: string;
	scope: ApiKeyScope;
	space_ids_json: string;
	own_entries_only: number;
	auto_own_space: number;
	expires_at: number | null;
	revoked_at: number | null;
	last_used_at: number | null;
	created_at: number;
	updated_at: number;
};

export type MintInput = {
	name: string;
	role: string;
	ops: string;
	scope: ApiKeyScope;
	spaceIds?: readonly string[];
	ownEntriesOnly?: boolean;
	autoOwnSpace?: boolean;
	expiresAt?: number | null;
};

const SELECT_BY_ID = "SELECT * FROM api_keys WHERE id = ?";

export async function mintApiKey(
	db: D1Database,
	pepper: string,
	input: MintInput,
	now = Date.now(),
): Promise<{ plaintext: string; row: ApiKeyRow }> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const row: ApiKeyRow = {
		id: material.keyid,
		name: input.name,
		secret_hash: secretHash,
		prev_secret_hash: null,
		prev_valid_until: null,
		role: input.role,
		ops: input.ops,
		scope: input.scope,
		space_ids_json: JSON.stringify(input.spaceIds ?? []),
		own_entries_only: input.ownEntriesOnly ? 1 : 0,
		auto_own_space: input.autoOwnSpace ? 1 : 0,
		expires_at: input.expiresAt ?? null,
		revoked_at: null,
		last_used_at: null,
		created_at: now,
		updated_at: now,
	};
	await db
		.prepare(
			`INSERT INTO api_keys (
        id, name, secret_hash, prev_secret_hash, prev_valid_until,
        role, ops, scope, space_ids_json, own_entries_only, auto_own_space,
        expires_at, revoked_at, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
		)
		.bind(
			row.id,
			row.name,
			row.secret_hash,
			row.role,
			row.ops,
			row.scope,
			row.space_ids_json,
			row.own_entries_only,
			row.auto_own_space,
			row.expires_at,
			row.created_at,
			row.updated_at,
		)
		.run();
	return { plaintext: material.plaintext, row };
}

async function loadRow(db: D1Database, id: string): Promise<ApiKeyRow | null> {
	return db.prepare(SELECT_BY_ID).bind(id).first<ApiKeyRow>();
}

export async function rotateApiKey(
	db: D1Database,
	pepper: string,
	id: string,
	graceMs = 0,
	now = Date.now(),
): Promise<{ plaintext: string; row: ApiKeyRow }> {
	if (graceMs < 0 || graceMs > MAX_GRACE_MS) {
		throw new Error("grace window must be between 0 and 7 days");
	}
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const prevValidUntil = now + graceMs;
	const row = await db
		.prepare(
			"UPDATE api_keys SET secret_hash = ?, prev_secret_hash = secret_hash, prev_valid_until = ?, updated_at = ? WHERE id = ? RETURNING *",
		)
		.bind(secretHash, prevValidUntil, now, id)
		.first<ApiKeyRow>();
	if (!row) {
		throw new Error("api key not found");
	}
	return { plaintext: `octo_${id}_${material.secret}`, row };
}

export async function revokeApiKey(db: D1Database, id: string, now = Date.now()): Promise<void> {
	const existing = await loadRow(db, id);
	if (!existing) {
		throw new Error("api key not found");
	}
	await db
		.prepare("UPDATE api_keys SET revoked_at = ?, updated_at = ? WHERE id = ?")
		.bind(now, now, id)
		.run();
}

export async function touchLastUsed(db: D1Database, id: string, now = Date.now()): Promise<void> {
	await db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now, id).run();
}

export async function lookupApiKey(
	db: D1Database,
	pepper: string,
	token: string,
	now = Date.now(),
): Promise<ApiKeyRow | null> {
	const parsed = parseApiKey(token);
	if (!parsed) {
		return null;
	}
	const row = await loadRow(db, parsed.keyid);
	if (!row || row.revoked_at != null) {
		return null;
	}
	if (row.expires_at != null && now >= row.expires_at) {
		return null;
	}
	if (await secretsMatch(pepper, parsed.secret, row.secret_hash)) {
		return row;
	}
	if (
		row.prev_secret_hash != null &&
		row.prev_valid_until != null &&
		now < row.prev_valid_until &&
		(await secretsMatch(pepper, parsed.secret, row.prev_secret_hash))
	) {
		return row;
	}
	return null;
}
