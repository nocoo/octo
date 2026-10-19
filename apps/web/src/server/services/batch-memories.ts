import type { MemoryCreate, MemoryPatch } from "../../lib/schema/memory";
import type { ApiPrincipal } from "../auth/authorize";
import type { AppVars } from "../env";
import { ApiError } from "../lib/errors";
import {
	MemoryRepo,
	type MemoryWrite,
	type MemoryRecord as StoredMemory,
	type StoredVector,
} from "../repo/memories";
import { TagRepo } from "../repo/tags";
import { authzFrom, MemoryService as M2MemoryService, publicMemory } from "./memories";

export type MemoryRecord = {
	id: string;
	space: string;
	space_id: string;
	source_key_id: string;
	title: string;
	body: string;
	type: string;
	tags: string[];
	importance: number;
	version: number;
	created_at: string;
	updated_at: string;
};

export type MemoryServiceContext = {
	db: D1Database;
	statements: D1PreparedStatement[];
	principal: ApiPrincipal;
	setWriteError?: (mapper: AppVars["writeError"]) => void;
	vectorMemoryIds?: string[];
};

export interface MemoryService {
	checkpoint(ctx: MemoryServiceContext): () => void;
	resolveSpace(slug: string, ctx: MemoryServiceContext): Promise<string>;
	get(id: string, ctx: MemoryServiceContext): Promise<MemoryRecord | null>;
	create(input: MemoryCreate, ctx: MemoryServiceContext): Promise<MemoryRecord>;
	update(
		id: string,
		patch: MemoryPatch & { expected_version: number },
		ctx: MemoryServiceContext,
	): Promise<MemoryRecord>;
	delete(id: string, ctx: MemoryServiceContext): Promise<{ trashed_at: string }>;
}

type WriteError = (error: unknown) => Promise<ApiError | undefined>;

class BatchMemoryRepo extends MemoryRepo {
	private rows = new Map<string, StoredMemory>();
	private tags = new Map<string, string[]>();
	private tagIds = new Map<string, string[]>();
	private vectors = new Map<string, StoredVector[]>();
	private errors = new Map<string, WriteError>();
	private readonly stagedErrors: WriteError[] = [];
	private committedReads = false;

	constructor(private readonly ctx: MemoryServiceContext) {
		super(ctx.db, (statements, mapError, memoryId) => {
			ctx.statements.push(...statements);
			this.stagedErrors.push(mapError);
			ctx.vectorMemoryIds?.push(memoryId);
		});
	}

	checkpoint(): () => void {
		const rows = new Map(this.rows);
		const tags = new Map(this.tags);
		const tagIds = new Map(this.tagIds);
		const vectors = new Map(this.vectors);
		const errors = new Map(this.errors);
		const errorCount = this.stagedErrors.length;
		const statementCount = this.ctx.statements.length;
		const memoryCount = this.ctx.vectorMemoryIds?.length ?? 0;
		return () => {
			this.rows = rows;
			this.tags = tags;
			this.tagIds = tagIds;
			this.vectors = vectors;
			this.errors = errors;
			this.stagedErrors.length = errorCount;
			this.ctx.statements.length = statementCount;
			if (this.ctx.vectorMemoryIds) this.ctx.vectorMemoryIds.length = memoryCount;
		};
	}

	override async get(id: string): Promise<StoredMemory | null> {
		if (!this.committedReads && this.rows.has(id)) return this.rows.get(id) ?? null;
		return super.get(id);
	}

	override async tagNamesByMemory(ids: string[]): Promise<Map<string, string[]>> {
		const result = await super.tagNamesByMemory(ids.filter((id) => !this.tags.has(id)));
		for (const id of ids) {
			const tags = this.tags.get(id);
			if (tags) result.set(id, tags);
		}
		return result;
	}

	override async tagIdsByMemory(id: string): Promise<string[]> {
		return this.tagIds.get(id) ?? super.tagIdsByMemory(id);
	}

	override async vectorsByMemory(id: string): Promise<StoredVector[]> {
		return this.vectors.get(id) ?? super.vectorsByMemory(id);
	}

	override async write(input: MemoryWrite): Promise<StoredMemory> {
		const index = this.stagedErrors.length;
		const row = await super.write(input);
		this.rows.set(row.id, row);
		this.tags.set(
			row.id,
			input.tags.map((tag) => tag.name),
		);
		this.tagIds.set(
			row.id,
			input.tags.map((tag) => tag.id),
		);
		if (
			input.vector !== null &&
			input.previous &&
			input.previous.title === input.title &&
			input.previous.body === input.body &&
			input.previous.content_hash !== row.content_hash
		) {
			this.vectors.set(
				row.id,
				(await this.vectorsByMemory(row.id)).map((stored) =>
					stored.content_hash === input.previous?.content_hash
						? { ...stored, content_hash: row.content_hash }
						: stored,
				),
			);
		}
		if (input.vector === null) {
			this.vectors.set(row.id, []);
		} else if (input.vector) {
			const vector = input.vector;
			this.vectors.set(row.id, [
				...(await this.vectorsByMemory(row.id)).filter(
					(stored) => stored.profile_id !== vector.profileId,
				),
				{
					profile_id: vector.profileId,
					embedding_model: vector.embeddingModel,
					dim: vector.dim,
					vector: vector.vector,
					content_hash: row.content_hash,
				},
			]);
		}
		this.retainInitialVersionError(row.id, index);
		return row;
	}

	override async trash(
		id: string,
		actor: string,
		now: number,
		expected: { version: number; spaceId: string },
	): Promise<StoredMemory> {
		const index = this.stagedErrors.length;
		const row = await super.trash(id, actor, now, expected);
		this.rows.set(id, row);
		this.retainInitialVersionError(id, index);
		return row;
	}

	async mapError(error: unknown): Promise<ApiError | undefined> {
		this.committedReads = true;
		try {
			for (const mapper of this.errors.values()) {
				const mapped = await mapper(error);
				if (mapped) return mapped;
			}
			return undefined;
		} finally {
			this.committedReads = false;
		}
	}

	private retainInitialVersionError(id: string, index: number): void {
		const mapper = this.stagedErrors[index];
		if (mapper && !this.errors.has(id)) this.errors.set(id, mapper);
	}
}

export class BatchMemoryService implements MemoryService {
	private readonly contexts = new WeakMap<
		MemoryServiceContext,
		{ repo: BatchMemoryRepo; service: M2MemoryService; authz: ReturnType<typeof authzFrom> }
	>();

	private state(ctx: MemoryServiceContext) {
		let state = this.contexts.get(ctx);
		if (!state) {
			const repo = new BatchMemoryRepo(ctx);
			state = {
				repo,
				service: new M2MemoryService(
					ctx.db,
					new TagRepo(ctx.db, undefined, undefined, ctx.statements),
					undefined,
					undefined,
					repo,
					undefined,
					undefined,
					ctx.statements,
				),
				authz: authzFrom(ctx.principal),
			};
			this.contexts.set(ctx, state);
			ctx.setWriteError?.((error) => repo.mapError(error));
		}
		return state;
	}

	checkpoint(ctx: MemoryServiceContext): () => void {
		const { repo, authz } = this.state(ctx);
		const restore = repo.checkpoint();
		const ownedSpaceIds = [...authz.principal.ownedSpaceIds];
		return () => {
			restore();
			authz.principal.ownedSpaceIds.splice(
				0,
				authz.principal.ownedSpaceIds.length,
				...ownedSpaceIds,
			);
		};
	}

	async resolveSpace(slug: string, ctx: MemoryServiceContext): Promise<string> {
		const space = await this.state(ctx).repo.spaceBySlug(slug);
		if (!space) throw new ApiError("not_found", "not found");
		return space.id;
	}

	async get(id: string, ctx: MemoryServiceContext): Promise<MemoryRecord | null> {
		const repo = this.state(ctx).repo;
		const row = await repo.get(id);
		if (!row || row.deleted_at !== null) return null;
		const tags = (await repo.tagNamesByMemory([id])).get(id) ?? [];
		return {
			...publicMemory(row, tags),
			id: row.id,
			space: row.space_slug,
			space_id: row.space_id,
			source_key_id: row.source_key_id,
			title: row.title,
			body: row.body,
			type: row.type,
			tags,
			importance: row.importance,
			version: row.version,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString(),
		};
	}

	async create(input: MemoryCreate, ctx: MemoryServiceContext): Promise<MemoryRecord> {
		const { service, authz } = this.state(ctx);
		return this.output(await service.create(authz, input), ctx);
	}

	async update(
		id: string,
		patch: MemoryPatch & { expected_version: number },
		ctx: MemoryServiceContext,
	): Promise<MemoryRecord> {
		const { service, authz } = this.state(ctx);
		return this.output(await service.patch(authz, id, patch, undefined), ctx);
	}

	async delete(id: string, ctx: MemoryServiceContext): Promise<{ trashed_at: string }> {
		const { service, authz } = this.state(ctx);
		return service.remove(authz, id);
	}

	private async output(
		result: Record<string, unknown>,
		ctx: MemoryServiceContext,
	): Promise<MemoryRecord> {
		const row = typeof result.id === "string" ? await this.get(result.id, ctx) : null;
		if (!row) throw new ApiError("internal", "memory write did not stage a record");
		return row;
	}
}
