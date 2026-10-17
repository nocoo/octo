import type { MemoryCreate, MemoryPatch } from "../../apps/web/src/lib/schema/memory";
import { ApiError } from "../../apps/web/src/server/lib/errors";
import type {
	MemoryRecord,
	MemoryService,
	MemoryServiceContext,
} from "../../apps/web/src/server/services/batch-memories";

export const MEMORY_FIXTURE_SQL = `CREATE TABLE IF NOT EXISTS _m6_memories (id TEXT PRIMARY KEY, record_json TEXT NOT NULL, deleted_at TEXT);
INSERT OR IGNORE INTO spaces (id, slug, name, created_at, updated_at) VALUES ('space:kb', 'kb', 'kb', 0, 0), ('space:s', 's', 's', 0, 0), ('space:dest', 'dest', 'dest', 0, 0), ('space:other', 'other', 'other', 0, 0);`;

export class TestMemoryService implements MemoryService {
	private readonly staged = new WeakMap<MemoryServiceContext, Map<string, MemoryRecord | null>>();
	private overlay(ctx: MemoryServiceContext) {
		let overlay = this.staged.get(ctx);
		if (!overlay) {
			overlay = new Map();
			this.staged.set(ctx, overlay);
		}
		return overlay;
	}
	async resolveSpace(slug: string, ctx: MemoryServiceContext): Promise<string> {
		const row = await ctx.db
			.prepare("SELECT id FROM spaces WHERE slug = ?")
			.bind(slug)
			.first<{ id: string }>();
		if (!row) throw new ApiError("not_found", "not found");
		return row.id;
	}
	async get(id: string, ctx: MemoryServiceContext): Promise<MemoryRecord | null> {
		const overlay = this.overlay(ctx);
		if (overlay.has(id)) return overlay.get(id) ?? null;
		const row = await ctx.db
			.prepare("SELECT record_json FROM _m6_memories WHERE id = ? AND deleted_at IS NULL")
			.bind(id)
			.first<{ record_json: string }>();
		return row ? (JSON.parse(row.record_json) as MemoryRecord) : null;
	}
	async create(input: MemoryCreate, ctx: MemoryServiceContext): Promise<MemoryRecord> {
		const now = new Date().toISOString();
		const record: MemoryRecord = {
			...input,
			id: crypto.randomUUID(),
			space_id: await this.resolveSpace(input.space, ctx),
			source_key_id: ctx.keyId,
			importance: input.importance ?? 0.5,
			version: 1,
			created_at: now,
			updated_at: now,
		};
		ctx.statements.push(
			ctx.db
				.prepare("INSERT INTO _m6_memories (id, record_json) VALUES (?, ?)")
				.bind(record.id, JSON.stringify(record)),
		);
		this.overlay(ctx).set(record.id, record);
		return record;
	}
	async update(
		id: string,
		patch: MemoryPatch & { expected_version: number },
		ctx: MemoryServiceContext,
	): Promise<MemoryRecord> {
		const existing = await this.get(id, ctx);
		if (!existing) throw new ApiError("not_found", "memory not found");
		if (existing.version !== patch.expected_version)
			throw new ApiError("version_conflict", "version mismatch", {
				current_version: existing.version,
			});
		const { expected_version: _, ...fields } = patch;
		const record: MemoryRecord = {
			...existing,
			...fields,
			space: patch.space ?? existing.space,
			title: patch.title ?? existing.title,
			body: patch.body ?? existing.body,
			type: patch.type ?? existing.type,
			tags: patch.tags ?? existing.tags,
			importance: patch.importance ?? existing.importance,
			space_id: patch.space ? await this.resolveSpace(patch.space, ctx) : existing.space_id,
			version: existing.version + 1,
			updated_at: new Date().toISOString(),
		};
		ctx.statements.push(
			ctx.db
				.prepare("UPDATE _m6_memories SET record_json = ? WHERE id = ?")
				.bind(JSON.stringify(record), id),
		);
		this.overlay(ctx).set(id, record);
		return record;
	}
	async delete(id: string, ctx: MemoryServiceContext): Promise<{ trashed_at: string }> {
		if (!(await this.get(id, ctx))) throw new ApiError("not_found", "memory not found");
		const trashed_at = new Date().toISOString();
		ctx.statements.push(
			ctx.db.prepare("UPDATE _m6_memories SET deleted_at = ? WHERE id = ?").bind(trashed_at, id),
		);
		this.overlay(ctx).set(id, null);
		return { trashed_at };
	}
}
