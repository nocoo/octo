import type { z } from "zod";
import {
	spaceManagementCreateSchema,
	spaceManagementPatchSchema,
} from "../../lib/schema/space-management";
import { type ApiPrincipal, principalActor } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import { serializeSpace } from "../lib/http";
import { newUlid } from "../lib/ulid";
import { parseStrict } from "../lib/validate";
import { SpaceRepo, type SpaceRow, type SpaceWithCount } from "../repo/spaces";

type SpaceCreate = z.output<typeof spaceManagementCreateSchema> & { owner_key_id?: string | null };
type SpacePatch = { [K in keyof SpaceCreate]?: SpaceCreate[K] | undefined };

export function requireSpaceAdmin(principal: ApiPrincipal): void {
	if (principal.role !== "admin") throw new ApiError("forbidden", "forbidden");
}

export function mapSpaceWriteError(error: unknown): ApiError | undefined {
	const message = String(error);
	if (message.includes("NOT NULL constraint failed: spaces.description")) {
		return new ApiError("space_not_empty", "space is not empty");
	}
	if (
		message.includes("UNIQUE constraint failed: spaces.slug") ||
		message.includes("NOT NULL constraint failed: spaces.name")
	) {
		return new ApiError("version_conflict", "space changed or slug already exists");
	}
	return undefined;
}

async function commitSpaceMutation(
	db: D1Database,
	mutation: D1PreparedStatement[],
	change: { id: string; op: string; actor: string; at: number },
	staged?: D1PreparedStatement[],
): Promise<void> {
	const statements = [
		...mutation,
		db
			.prepare(
				"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('space', ?, ?, ?, NULL, ?, ?)",
			)
			.bind(change.id, change.id, change.op, change.actor, change.at),
	];
	if (staged) {
		staged.push(...statements);
		return;
	}
	try {
		await db.batch(statements);
	} catch (error) {
		throw mapSpaceWriteError(error) ?? error;
	}
}

function guardSpace(db: D1Database, row: SpaceRow): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO spaces (id, slug, name, created_at, updated_at) SELECT ?, ?, NULL, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM spaces WHERE id = ? AND updated_at = ?)",
		)
		.bind(row.id, row.slug, row.id, row.updated_at);
}

export async function validateOwner(db: D1Database, id: string | null): Promise<void> {
	if (id === null) return;
	if (!(await db.prepare("SELECT id FROM api_keys WHERE id = ?").bind(id).first())) {
		throw new ApiError("validation_failed", "unknown owner_key_id");
	}
}

export async function createSpace(
	db: D1Database,
	input: SpaceCreate,
	actor: string,
	staged?: D1PreparedStatement[],
): Promise<SpaceRow> {
	const owner = input.owner_key_id ?? null;
	await validateOwner(db, owner);
	if (await db.prepare("SELECT id FROM spaces WHERE slug = ?").bind(input.slug).first()) {
		throw new ApiError("version_conflict", "space slug already exists");
	}
	const now = Date.now();
	const row: SpaceRow = {
		...input,
		owner_key_id: owner,
		id: newUlid(),
		created_at: now,
		updated_at: now,
	};
	await commitSpaceMutation(
		db,
		[
			db
				.prepare(
					"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(row.id, row.slug, row.name, row.description, owner, now, now),
		],
		{ id: row.id, op: "created", actor, at: now },
		staged,
	);
	return row;
}

export async function updateSpace(
	db: D1Database,
	row: SpaceRow,
	patch: SpacePatch,
	actor: string,
	staged?: D1PreparedStatement[],
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
	if (updated.owner_key_id !== row.owner_key_id) await validateOwner(db, updated.owner_key_id);
	await commitSpaceMutation(
		db,
		[
			guardSpace(db, row),
			db
				.prepare(
					"UPDATE spaces SET slug = ?, name = ?, description = ?, owner_key_id = ?, updated_at = ? WHERE id = ?",
				)
				.bind(updated.slug, updated.name, updated.description, updated.owner_key_id, now, row.id),
		],
		{ id: row.id, op: "updated", actor, at: now },
		staged,
	);
	return updated;
}

export async function deleteSpace(
	db: D1Database,
	row: SpaceRow,
	actor: string,
	staged?: D1PreparedStatement[],
): Promise<void> {
	if (await db.prepare("SELECT id FROM memories WHERE space_id = ? LIMIT 1").bind(row.id).first()) {
		throw new ApiError("space_not_empty", "space is not empty");
	}
	await commitSpaceMutation(
		db,
		[
			guardSpace(db, row),
			db
				.prepare(
					"INSERT INTO spaces (id, slug, name, description, created_at, updated_at) SELECT ?, ?, '', NULL, 0, 0 WHERE EXISTS (SELECT 1 FROM memories WHERE space_id = ?)",
				)
				.bind(row.id, row.slug, row.id),
			db.prepare("DELETE FROM spaces WHERE id = ?").bind(row.id),
		],
		{ id: row.id, op: "deleted", actor, at: Date.now() },
		staged,
	);
}

async function loadSpace(db: D1Database, slug: string): Promise<SpaceWithCount> {
	const row = await new SpaceRepo(db).getVisibleBySlug(slug, { kind: "all" });
	if (!row) throw new ApiError("not_found", "space not found");
	return row;
}

export async function createManagedSpace(
	db: D1Database,
	principal: ApiPrincipal,
	input: z.input<typeof spaceManagementCreateSchema>,
	staged?: D1PreparedStatement[],
) {
	requireSpaceAdmin(principal);
	const row = await createSpace(
		db,
		parseStrict(spaceManagementCreateSchema, input),
		principalActor(principal),
		staged,
	);
	return serializeSpace({ ...row, memory_count: 0 });
}

export async function updateManagedSpace(
	db: D1Database,
	principal: ApiPrincipal,
	slug: string,
	patch: z.input<typeof spaceManagementPatchSchema>,
	staged?: D1PreparedStatement[],
) {
	requireSpaceAdmin(principal);
	const input = parseStrict(spaceManagementPatchSchema, patch);
	const row = await loadSpace(db, slug);
	return serializeSpace({
		...(await updateSpace(db, row, input, principalActor(principal), staged)),
		memory_count: row.memory_count,
	});
}

export async function deleteManagedSpace(
	db: D1Database,
	principal: ApiPrincipal,
	slug: string,
	staged?: D1PreparedStatement[],
) {
	requireSpaceAdmin(principal);
	const row = await loadSpace(db, slug);
	await deleteSpace(db, row, principalActor(principal), staged);
	return { id: row.id, slug: row.slug, deleted: true as const };
}
