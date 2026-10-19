import type { MemoryFilters } from "../../lib/schema/filters";
import type { MemoryCreate, MemoryPatch } from "../../lib/schema/memory";
import type { MemoryMove } from "../../lib/schema/memory-move";
import {
	type ApiPrincipal,
	type AuthzOp,
	type AuthzTarget,
	authorize,
	principalActor,
	visibleSpaceIds,
} from "../auth/authorize";
import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";
import { ChangeRepo } from "../repo/changes";
import { type MemoryRecord, MemoryRepo } from "../repo/memories";
import { encodeCursor, parseChangeCursor, parseMemoryCursor } from "../repo/memories-cursor";
import { resolveVectorWrite } from "../repo/memories-vector";
import { ensureAutoOwnSpace, prepareOwnSpace, type SpaceRow } from "../repo/spaces";
import { normalizeTag, TagRepo } from "../repo/tags";
import { diffVersions, VersionRepo } from "../repo/versions";

export type Authz = {
	principal: ApiPrincipal & { ownedSpaceIds: string[] };
	actor: string;
	denyUnless(op: AuthzOp, target: AuthzTarget): void;
	visible(): ReturnType<typeof visibleSpaceIds>;
};

export function authzFrom(principal: ApiPrincipal): Authz {
	const ownedSpaceIds = [...principal.ownedSpaceIds];
	const key: ApiPrincipal & { ownedSpaceIds: string[] } = { ...principal, ownedSpaceIds };
	return {
		principal: key,
		actor: principalActor(key),
		denyUnless(op, target) {
			const result = authorize(key, op, target);
			if (result.allow) {
				return;
			}
			if (result.reason === "not_found") {
				throw new ApiError("not_found", "not found");
			}
			throw new ApiError("forbidden", "forbidden");
		},
		visible: () => visibleSpaceIds(key),
	};
}

export function expectedVersion(ifMatch: string | undefined, body?: number): number {
	const trimmed = ifMatch?.trim();
	if (trimmed !== undefined && !/^(?:\d+|"\d+")$/.test(trimmed))
		throw new ApiError("validation_failed", "invalid If-Match version");
	const headerVer = trimmed === undefined ? undefined : Number(trimmed.replaceAll('"', ""));
	if (headerVer !== undefined && (!Number.isSafeInteger(headerVer) || headerVer < 0))
		throw new ApiError("validation_failed", "invalid If-Match version");
	if (headerVer != null && body != null && headerVer !== body) {
		throw new ApiError("validation_failed", "If-Match does not match expected_version");
	}
	const version = body ?? headerVer;
	if (version == null) {
		throw new ApiError("validation_failed", "expected_version is required");
	}
	return version;
}

function requireCurrentVersion(current: MemoryRecord, requested: number): number {
	if (requested !== current.version) {
		throw new ApiError(
			"version_conflict",
			`memory ${current.id} is at version ${current.version}, expected ${requested}`,
			{ current_version: current.version },
		);
	}
	return current.version;
}

export function parseInclude(raw: string | undefined): Set<string> {
	if (!raw) {
		return new Set();
	}
	return new Set(
		raw
			.split(",")
			.map((part) => part.trim())
			.filter((part) => part.length > 0),
	);
}

function iso(ms: number | null): string | null {
	if (ms == null) {
		return null;
	}
	return new Date(ms).toISOString();
}

export function publicMemory(
	row: Omit<MemoryRecord, "body"> & { body?: string },
	tags: string[],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const item: Record<string, unknown> = {
		id: row.id,
		space: row.space_slug,
		title: row.title,
		body: row.body,
		type: row.type,
		tags,
		importance: row.importance,
		event_time: iso(row.event_time),
		version: row.version,
		content_hash: row.content_hash,
		source_key_id: row.source_key_id,
		updated_by_key_id: row.updated_by_key_id,
		created_at: iso(row.created_at),
		updated_at: iso(row.updated_at),
		...extra,
	};
	if (row.deleted_at != null) {
		item.deleted_at = iso(row.deleted_at);
		item.deleted_by = row.deleted_by;
	}
	return item;
}

export function publicVersion(
	row: {
		memory_id: string;
		version: number;
		title: string;
		type: string;
		importance: number;
		tags_json: string;
		event_time: number | null;
		space_id: string;
		actor: string;
		op: string;
		rollback_of: number | null;
		created_at: number;
		body?: string;
	},
	includeBody: boolean,
): Record<string, unknown> {
	let tags: string[] = [];
	try {
		const parsed: unknown = JSON.parse(row.tags_json);
		if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
			tags = parsed;
		}
	} catch {
		tags = [];
	}
	const item: Record<string, unknown> = {
		memory_id: row.memory_id,
		version: row.version,
		title: row.title,
		type: row.type,
		importance: row.importance,
		tags,
		event_time: iso(row.event_time),
		space_id: row.space_id,
		actor: row.actor,
		op: row.op,
		rollback_of: row.rollback_of,
		created_at: iso(row.created_at),
	};
	if (includeBody) {
		item.body = row.body;
	}
	return item;
}

export class MemoryService {
	private pendingOwnSpace?: { row: SpaceRow; statement: D1PreparedStatement };

	constructor(
		private readonly db: D1Database,
		private readonly tags: TagRepo = new TagRepo(db),
		private readonly now: () => number = Date.now,
		private readonly id: () => string = newUlid,
		private readonly memories = new MemoryRepo(db),
		private readonly versions = new VersionRepo(db),
		private readonly changes = new ChangeRepo(db),
		private readonly statements?: D1PreparedStatement[],
	) {}

	async create(authz: Authz, input: MemoryCreate): Promise<Record<string, unknown>> {
		let own: SpaceRow | null = null;
		if (authz.principal.autoOwnSpace) {
			if (!authz.principal.ops.has("w")) {
				const target = await this.memories.spaceBySlug(input.space);
				if (target) {
					authz.denyUnless("write", { spaceId: target.id });
				}
				throw new ApiError("forbidden", "forbidden");
			}
			own = this.statements
				? await this.stagedOwnSpace(authz, this.statements)
				: await ensureAutoOwnSpace(
						this.db,
						{
							id: authz.principal.id,
							name: authz.principal.name,
							auto_own_space: 1,
						},
						this.now,
						this.id,
					);
			if (own && !authz.principal.ownedSpaceIds.includes(own.id)) {
				authz.principal.ownedSpaceIds.push(own.id);
			}
		}
		const space = own?.slug === input.space ? own : await this.requireSpace(input.space);
		authz.denyUnless("write", { spaceId: space.id });
		const tags = await this.tags.resolveMany(input.tags);
		const vector = input.vector ? await resolveVectorWrite(this.db, input.vector) : undefined;
		const row = await this.memories.write({
			id: this.id(),
			spaceId: space.id,
			spaceSlug: space.slug,
			title: input.title,
			body: input.body,
			type: input.type,
			importance: input.importance ?? 0.5,
			eventTime: input.event_time ? Date.parse(input.event_time) : null,
			tags,
			actor: authz.actor,
			sourceKeyId: authz.principal.id,
			updatedByKeyId: authz.principal.id,
			op: "create",
			now: this.now(),
			...(vector ? { vector } : {}),
		});
		return publicMemory(
			row,
			tags.map((tag) => tag.name),
		);
	}

	private async stagedOwnSpace(authz: Authz, statements: D1PreparedStatement[]): Promise<SpaceRow> {
		if (this.pendingOwnSpace && statements.includes(this.pendingOwnSpace.statement))
			return this.pendingOwnSpace.row;
		const prepared = await prepareOwnSpace(this.db, authz.principal, this.now, this.id);
		if (prepared.statement) {
			statements.push(prepared.statement);
			this.pendingOwnSpace = { row: prepared.row, statement: prepared.statement };
		}
		return prepared.row;
	}

	async get(authz: Authz, id: string, include: Set<string>): Promise<Record<string, unknown>> {
		const row = await this.loadVisible(authz, id, "read", include.has("trashed"));
		if (include.has("trashed")) {
			authz.denyUnless("delete", { spaceId: row.space_id, sourceKeyId: row.source_key_id });
		}
		const tags = (await this.memories.tagNamesByMemory([row.id])).get(row.id) ?? [];
		const extra: Record<string, unknown> = {};
		if (include.has("versions_count")) {
			extra.versions_count = await this.memories.versionsCount(row.id);
		}
		if (include.has("attachments")) {
			extra.attachments = (await this.memories.attachments(row.id)).map((att) => ({
				...att,
				created_at: iso(att.created_at),
			}));
		}
		if (include.has("vector_status")) {
			const stored = await this.memories.vectorStatus(row.id, row.content_hash);
			const { results } = await this.db
				.prepare(`SELECT profile.id AS profile, COALESCE(counter.calls, 0) AS embedding_calls
				FROM embedding_profiles profile LEFT JOIN memory_embedding_calls counter ON counter.profile_id = profile.id AND counter.memory_id = ?
				WHERE profile.active = 1 OR counter.memory_id IS NOT NULL OR EXISTS
				(SELECT 1 FROM memory_vectors vector WHERE vector.memory_id = ? AND vector.profile_id = profile.id)
				ORDER BY profile.id`)
				.bind(row.id, row.id)
				.all<{ profile: string; embedding_calls: number }>();
			const statuses = new Map(
				stored.map((status) => [status.profile, { ...status, embedding_calls: 0 }]),
			);
			for (const counter of results) {
				const status = statuses.get(counter.profile) ?? {
					profile: counter.profile,
					indexed: false,
					stale: false,
					embedding_calls: 0,
				};
				statuses.set(counter.profile, { ...status, embedding_calls: counter.embedding_calls });
			}
			extra.vector_status = [...statuses.values()];
		}
		if (!(await this.memories.unchangedIds([row])).has(row.id))
			throw new ApiError("not_found", "not found");
		return publicMemory(row, tags, extra);
	}

	async list(
		authz: Authz,
		opts: {
			filters: MemoryFilters;
			include: Set<string>;
			cursor?: string | undefined;
			limit: number;
			trashedOnly?: boolean | undefined;
		},
	): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
		if (!authz.principal.ops.has(opts.trashedOnly ? "d" : "r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		if (opts.include.has("trashed") && !authz.principal.ops.has("d")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const visible = authz.visible();
		const spaceIds = await this.filterSpaceIds(opts.filters.spaces, visible);
		const tagAllIds = opts.filters.tags_all
			? await this.requireTagIds(opts.filters.tags_all, true)
			: undefined;
		const tagAnyIds = opts.filters.tags_any
			? await this.requireTagIds(opts.filters.tags_any, false)
			: undefined;
		const listed = await this.memories.list({
			filters: opts.filters,
			visible,
			spaceIds,
			tagAllIds,
			tagAnyIds,
			includeTrashed: opts.include.has("trashed"),
			trashedOnly: opts.trashedOnly,
			ownSourceKeyId:
				(opts.trashedOnly || opts.include.has("trashed")) && authz.principal.ownEntriesOnly
					? authz.principal.id
					: undefined,
			cursor: opts.cursor ? parseMemoryCursor(opts.cursor) : undefined,
			limit: opts.limit,
		});
		const tagMap = await this.memories.tagNamesByMemory(listed.items.map((item) => item.id));
		const unchanged = await this.memories.unchangedIds(listed.items);
		return {
			items: listed.items
				.filter((item) => unchanged.has(item.id))
				.map((item) => publicMemory(item, tagMap.get(item.id) ?? [])),
			next_cursor: listed.next_cursor,
		};
	}

	async patch(
		authz: Authz,
		id: string,
		input: MemoryPatch,
		ifMatch: string | undefined,
	): Promise<Record<string, unknown>> {
		const current = await this.loadVisible(authz, id, "update", false);
		const version = requireCurrentVersion(
			current,
			expectedVersion(ifMatch, input.expected_version),
		);
		let spaceId = current.space_id;
		let op: "update" | "move" = "update";
		if (input.space) {
			const dest = await this.requireSpace(input.space);
			if (dest.id !== current.space_id) {
				authz.denyUnless("move", {
					spaceId: current.space_id,
					destSpaceId: dest.id,
					sourceKeyId: current.source_key_id,
				});
				spaceId = dest.id;
				op = "move";
			}
		}
		if (op === "update") {
			authz.denyUnless("update", { spaceId: current.space_id, sourceKeyId: current.source_key_id });
		}
		const tags =
			input.tags !== undefined
				? await this.tags.resolveMany(input.tags)
				: await this.currentTags(current.id);
		let vector: Awaited<ReturnType<typeof resolveVectorWrite>> | null | undefined;
		if (input.vector === null) {
			vector = null;
		} else if (input.vector) {
			vector = await resolveVectorWrite(this.db, input.vector);
		}
		const row = await this.memories.write({
			id: current.id,
			previous: current,
			spaceId,
			title: input.title ?? current.title,
			body: input.body ?? current.body,
			type: input.type ?? current.type,
			importance: input.importance ?? current.importance,
			eventTime:
				input.event_time === undefined
					? current.event_time
					: input.event_time === null
						? null
						: Date.parse(input.event_time),
			tags,
			actor: authz.actor,
			sourceKeyId: current.source_key_id,
			updatedByKeyId: authz.principal.id,
			op,
			expectedVersion: version,
			now: this.now(),
			...(vector !== undefined ? { vector } : {}),
		});
		return publicMemory(
			row,
			tags.map((tag) => tag.name),
		);
	}

	async move(
		authz: Authz,
		id: string,
		input: MemoryMove,
		ifMatch?: string,
	): Promise<Record<string, unknown>> {
		const current = await this.loadVisible(authz, id, "update", false);
		const destination = await this.requireSpace(input.space);
		authz.denyUnless("move", {
			spaceId: current.space_id,
			destSpaceId: destination.id,
			sourceKeyId: current.source_key_id,
		});
		const version =
			ifMatch === undefined && input.expected_version === undefined
				? current.version
				: expectedVersion(ifMatch, input.expected_version);
		return this.patch(authz, id, { space: input.space, expected_version: version }, undefined);
	}

	async remove(authz: Authz, id: string): Promise<{ trashed_at: string }> {
		const current = await this.loadVisible(authz, id, "delete", false);
		const row = await this.memories.trash(current.id, authz.actor, this.now(), {
			version: current.version,
			spaceId: current.space_id,
		});
		return { trashed_at: iso(row.deleted_at) ?? new Date(this.now()).toISOString() };
	}

	async restore(authz: Authz, id: string): Promise<Record<string, unknown>> {
		const current = await this.loadVisible(authz, id, "delete", true);
		if (current.deleted_at == null) {
			throw new ApiError("not_found", "not found");
		}
		const tags = await this.currentTags(current.id);
		const row = await this.memories.write({
			id: current.id,
			previous: current,
			spaceId: current.space_id,
			title: current.title,
			body: current.body,
			type: current.type,
			importance: current.importance,
			eventTime: current.event_time,
			tags,
			actor: authz.actor,
			sourceKeyId: current.source_key_id,
			updatedByKeyId: authz.principal.id,
			op: "restore",
			expectedVersion: current.version,
			now: this.now(),
		});
		return publicMemory(
			row,
			tags.map((tag) => tag.name),
		);
	}

	async listVersions(authz: Authz, id: string): Promise<Record<string, unknown>[]> {
		const current = await this.loadVisible(authz, id, "read", false);
		const rows = await this.versions.list(id, current);
		return rows.map((row) => publicVersion(row, false));
	}

	async getVersion(authz: Authz, id: string, version: number): Promise<Record<string, unknown>> {
		const current = await this.loadVisible(authz, id, "read", false);
		const row = await this.versions.get(id, version, current);
		if (!row) {
			throw new ApiError("not_found", "not found");
		}
		return publicVersion(row, true);
	}

	async diff(authz: Authz, id: string, from: number, to: number): Promise<unknown> {
		const current = await this.loadVisible(authz, id, "read", false);
		const left = await this.versions.get(id, from, current);
		const right = await this.versions.get(id, to, current);
		if (!left || !right) {
			throw new ApiError("unprocessable", "version does not exist");
		}
		return diffVersions(left, right);
	}

	async rollback(
		authz: Authz,
		id: string,
		toVersion: number,
		ifMatch: string | undefined,
		bodyVersion?: number,
	): Promise<Record<string, unknown>> {
		const current = await this.loadVisible(authz, id, "update", false);
		const version = requireCurrentVersion(current, expectedVersion(ifMatch, bodyVersion));
		const snapshot = await this.versions.get(id, toVersion, current);
		if (!snapshot) {
			throw new ApiError("unprocessable", "version does not exist");
		}
		if (snapshot.space_id !== current.space_id) {
			authz.denyUnless("move", {
				spaceId: current.space_id,
				destSpaceId: snapshot.space_id,
				sourceKeyId: current.source_key_id,
			});
		}
		let names: unknown;
		try {
			names = JSON.parse(snapshot.tags_json);
		} catch {
			throw new ApiError("unprocessable", "invalid version tags");
		}
		if (!Array.isArray(names) || !names.every((item) => typeof item === "string")) {
			throw new ApiError("unprocessable", "invalid version tags");
		}
		const tags = await this.tags.resolveMany(names);
		const row = await this.memories.write({
			id: current.id,
			previous: current,
			spaceId: snapshot.space_id,
			title: snapshot.title,
			body: snapshot.body,
			type: snapshot.type,
			importance: snapshot.importance,
			eventTime: snapshot.event_time,
			tags,
			actor: authz.actor,
			sourceKeyId: current.source_key_id,
			updatedByKeyId: authz.principal.id,
			op: "rollback",
			rollbackOf: toVersion,
			expectedVersion: version,
			now: this.now(),
		});
		return publicMemory(
			row,
			tags.map((tag) => tag.name),
		);
	}

	async listChanges(
		authz: Authz,
		opts: { cursor?: string | undefined; limit: number; spaces?: string[] | undefined },
	): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
		if (!authz.principal.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const visible = authz.visible();
		const spaceIds = await this.filterSpaceIds(opts.spaces, visible);
		const listed = await this.changes.list(visible, {
			cursor: opts.cursor ? parseChangeCursor(opts.cursor) : undefined,
			limit: opts.limit,
			spaceIds,
		});
		return {
			items: listed.items.map((item) => this.changes.publicItem(item)),
			next_cursor: listed.next_cursor,
		};
	}

	async changesHead(authz: Authz, spaces?: string[] | undefined): Promise<{ cursor: string }> {
		if (!authz.principal.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const visible = authz.visible();
		const spaceIds = await this.filterSpaceIds(spaces, visible);
		const seq = await this.changes.head(visible, spaceIds);
		return { cursor: encodeCursor({ s: seq }) };
	}

	private async loadVisible(
		authz: Authz,
		id: string,
		op: AuthzOp,
		allowTrashed: boolean,
	): Promise<MemoryRecord> {
		const row = await this.memories.get(id);
		if (!row) {
			throw new ApiError("not_found", "not found");
		}
		if (row.deleted_at != null && !allowTrashed) {
			throw new ApiError("not_found", "not found");
		}
		authz.denyUnless(op, { spaceId: row.space_id, sourceKeyId: row.source_key_id });
		return row;
	}

	private async requireSpace(slug: string): Promise<{ id: string; slug: string; name: string }> {
		const space = await this.memories.spaceBySlug(slug);
		if (!space) {
			throw new ApiError("not_found", "not found");
		}
		return space;
	}

	private async currentTags(
		memoryId: string,
	): Promise<
		Array<{ id: string; name: string; display_name: string; merged_into: string | null }>
	> {
		const resolved = new Map<
			string,
			{ id: string; name: string; display_name: string; merged_into: string | null }
		>();
		const ids = await this.memories.tagIdsByMemory(memoryId);
		const rows = await this.tags.getManyByIds(ids);
		for (const id of ids) {
			const row = rows.get(id);
			if (!row) throw new ApiError("tag_conflict", "memory tags changed");
			const canonical = await this.tags.follow(row);
			resolved.set(canonical.id, canonical);
		}
		return [...resolved.values()];
	}

	private async filterSpaceIds(
		slugs: string[] | undefined,
		visible: ReturnType<typeof visibleSpaceIds>,
	): Promise<string[] | undefined> {
		if (!slugs) {
			return undefined;
		}
		const ids: string[] = [];
		for (const slug of slugs) {
			const space = await this.memories.spaceBySlug(slug);
			if (!space) {
				continue;
			}
			if (visible.kind === "all" || visible.ids.includes(space.id)) {
				ids.push(space.id);
			}
		}
		return ids;
	}

	private async requireTagIds(names: string[], all: boolean): Promise<string[]> {
		const unique: string[] = [];
		const seen = new Set<string>();
		for (const raw of names) {
			const name = normalizeTag(raw);
			if (!seen.has(name)) {
				seen.add(name);
				unique.push(name);
			}
		}
		const resolved: string[] = [];
		let missing = false;
		const seenIds = new Set<string>();
		for (const name of unique) {
			const row = await this.tags.getByName(name);
			if (!row) {
				missing = true;
				continue;
			}
			const canonical = await this.tags.follow(row);
			if (!seenIds.has(canonical.id)) {
				seenIds.add(canonical.id);
				resolved.push(canonical.id);
			}
		}
		if (all && missing) {
			return [];
		}
		return resolved;
	}
}
