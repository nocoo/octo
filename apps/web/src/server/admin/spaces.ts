import { z } from "zod";
import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";
import type { SpaceRow } from "../repo/spaces";
import { commitAdminMutation } from "./common";

const fields = {
	slug: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
	name: z.string().trim().min(1).max(256),
	description: z.string().max(10000),
	owner_key_id: z.string().min(1).nullable(),
};
export const spaceCreateSchema = z.strictObject({
	...fields,
	description: fields.description.default(""),
	owner_key_id: fields.owner_key_id.default(null),
});
export const spacePatchSchema = z
	.strictObject(fields)
	.partial()
	.refine((input) => Object.keys(input).length > 0);

export async function validateOwner(db: D1Database, id: string | null): Promise<void> {
	if (id === null) return;
	if (!(await db.prepare("SELECT id FROM api_keys WHERE id = ?").bind(id).first())) {
		throw new ApiError("validation_failed", "unknown owner_key_id");
	}
}

export async function createSpace(
	db: D1Database,
	input: z.infer<typeof spaceCreateSchema>,
	actor: string,
): Promise<SpaceRow> {
	await validateOwner(db, input.owner_key_id);
	const now = Date.now();
	const row: SpaceRow = { ...input, id: newUlid(), created_at: now, updated_at: now };
	await commitAdminMutation(
		db,
		db
			.prepare(
				"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(row.id, row.slug, row.name, row.description, row.owner_key_id, now, now),
		{ entity: "space", id: row.id, op: "created", actor, at: now },
	);
	return row;
}

export async function updateSpace(
	db: D1Database,
	row: SpaceRow,
	patch: z.infer<typeof spacePatchSchema>,
	actor: string,
): Promise<SpaceRow> {
	const now = Math.max(Date.now(), row.updated_at + 1);
	const updated: SpaceRow = {
		...row,
		slug: patch.slug ?? row.slug,
		name: patch.name ?? row.name,
		description: patch.description ?? row.description,
		owner_key_id: patch.owner_key_id === undefined ? row.owner_key_id : patch.owner_key_id,
		updated_at: now,
	};
	await validateOwner(db, updated.owner_key_id);
	await commitAdminMutation(
		db,
		db
			.prepare(
				"UPDATE spaces SET slug = ?, name = ?, description = ?, owner_key_id = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
			)
			.bind(
				updated.slug,
				updated.name,
				updated.description,
				updated.owner_key_id,
				now,
				row.id,
				row.updated_at,
			),
		{ entity: "space", id: row.id, op: "updated", actor, at: now },
	);
	return updated;
}

export async function deleteSpace(db: D1Database, row: SpaceRow, actor: string): Promise<void> {
	await commitAdminMutation(
		db,
		db
			.prepare(
				"DELETE FROM spaces WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memories WHERE space_id = ?)",
			)
			.bind(row.id, row.id),
		{ entity: "space", id: row.id, op: "deleted", actor, at: Date.now() },
	);
}
