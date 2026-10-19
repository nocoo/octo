import { type ApiKeyRow, generateApiKeyMaterial, hashSecret } from "../auth/api-key";
import { ApiError } from "../lib/errors";
import { isoUtc } from "../lib/http";
import { conflict } from "./common";
import type { ResolvedKeyInput } from "./key-input";

export function publicKey(row: ApiKeyRow): Record<string, unknown> {
	return {
		id: row.id,
		name: row.name,
		role: row.role,
		ops: row.ops,
		scope: row.scope,
		space_ids: JSON.parse(row.space_ids_json) as string[],
		own_entries_only: row.own_entries_only === 1,
		auto_own_space: row.auto_own_space === 1,
		expires_at: row.expires_at === null ? null : isoUtc(row.expires_at),
		revoked_at: row.revoked_at === null ? null : isoUtc(row.revoked_at),
		last_used_at: row.last_used_at === null ? null : isoUtc(row.last_used_at),
		created_at: isoUtc(row.created_at),
		updated_at: isoUtc(row.updated_at),
	};
}

export async function loadKey(db: D1Database, id: string): Promise<ApiKeyRow> {
	const row = await db.prepare("SELECT * FROM api_keys WHERE id = ?").bind(id).first<ApiKeyRow>();
	if (!row) throw new ApiError("not_found", "key not found");
	return row;
}

function requirePepper(pepper: string | undefined): string {
	if (!pepper) throw new ApiError("unavailable", "key management unavailable");
	return pepper;
}

async function commitKeyMutation(statement: D1PreparedStatement): Promise<void> {
	try {
		const result = await statement.run();
		if (result.meta.changes === 0) throw conflict("resource changed");
	} catch (error) {
		if (error instanceof Error && /UNIQUE constraint failed: api_keys.name/.test(error.message)) {
			throw conflict("name already exists");
		}
		throw error;
	}
}

export async function createKey(
	db: D1Database,
	pepper: string | undefined,
	input: ResolvedKeyInput,
) {
	const material = generateApiKeyMaterial();
	const hash = await hashSecret(requirePepper(pepper), material.secret);
	const now = Date.now();
	await commitKeyMutation(
		db
			.prepare(
				"INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(
				material.keyid,
				input.name,
				hash,
				input.role,
				input.ops,
				input.scope,
				JSON.stringify(input.spaceIds),
				Number(input.ownEntriesOnly),
				Number(input.autoOwnSpace),
				input.expiresAt,
				now,
				now,
			),
	);
	return { key: publicKey(await loadKey(db, material.keyid)), plaintext: material.plaintext };
}

export async function updateKey(db: D1Database, row: ApiKeyRow, input: ResolvedKeyInput) {
	const now = Math.max(Date.now(), row.updated_at + 1);
	await commitKeyMutation(
		db
			.prepare(
				"UPDATE api_keys SET name = ?, role = ?, ops = ?, scope = ?, space_ids_json = ?, own_entries_only = ?, auto_own_space = ?, expires_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
			)
			.bind(
				input.name,
				input.role,
				input.ops,
				input.scope,
				JSON.stringify(input.spaceIds),
				Number(input.ownEntriesOnly),
				Number(input.autoOwnSpace),
				input.expiresAt,
				now,
				row.id,
				row.updated_at,
			),
	);
	return publicKey(await loadKey(db, row.id));
}

export async function rotateKey(
	db: D1Database,
	pepper: string | undefined,
	row: ApiKeyRow,
	graceMs: number,
) {
	if (row.revoked_at !== null) throw conflict("revoked keys cannot be rotated");
	const material = generateApiKeyMaterial();
	const hash = await hashSecret(requirePepper(pepper), material.secret);
	const now = Date.now();
	const updatedAt = Math.max(now, row.updated_at + 1);
	await commitKeyMutation(
		db
			.prepare(
				"UPDATE api_keys SET secret_hash = ?, prev_secret_hash = secret_hash, prev_valid_until = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL AND secret_hash = ? AND updated_at = ?",
			)
			.bind(hash, now + graceMs, updatedAt, row.id, row.secret_hash, row.updated_at),
	);
	return {
		key: publicKey(await loadKey(db, row.id)),
		plaintext: `octo_${row.id}_${material.secret}`,
	};
}

export async function revokeKey(db: D1Database, row: ApiKeyRow) {
	if (row.revoked_at !== null) return publicKey(row);
	const now = Math.max(Date.now(), row.updated_at + 1);
	await commitKeyMutation(
		db
			.prepare(
				"UPDATE api_keys SET revoked_at = ?, prev_secret_hash = NULL, prev_valid_until = NULL, updated_at = ? WHERE id = ? AND revoked_at IS NULL AND updated_at = ?",
			)
			.bind(now, now, row.id, row.updated_at),
	);
	return publicKey(await loadKey(db, row.id));
}

export async function deleteKey(db: D1Database, row: ApiKeyRow) {
	if (row.revoked_at === null) throw conflict("revoke the key before deleting it");
	await commitKeyMutation(
		db
			.prepare("DELETE FROM api_keys WHERE id = ? AND revoked_at IS NOT NULL AND updated_at = ?")
			.bind(row.id, row.updated_at),
	);
	return { id: row.id, deleted: true };
}
