import type { AttachmentRecord } from "./types";

export type MemoryRow = {
	id: string;
	space_id: string;
	source_key_id: string;
	deleted_at: number | null;
};

export type AttachmentRepoDeps = {
	db: D1Database;
};

export function attachmentR2Key(memoryId: string, attachmentId: string): string {
	return `att/${memoryId}/${attachmentId}`;
}

export class AttachmentRepo {
	constructor(private readonly deps: AttachmentRepoDeps) {}

	async getMemory(memoryId: string): Promise<MemoryRow | null> {
		return this.deps.db
			.prepare("SELECT id, space_id, source_key_id, deleted_at FROM memories WHERE id = ?")
			.bind(memoryId)
			.first<MemoryRow>();
	}

	async getAttachment(id: string): Promise<AttachmentRecord | null> {
		return this.deps.db
			.prepare(
				"SELECT id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at, deleted_at FROM attachments WHERE id = ?",
			)
			.bind(id)
			.first<AttachmentRecord>();
	}

	async listForMemory(memoryId: string): Promise<AttachmentRecord[]> {
		const { results } = await this.deps.db
			.prepare(
				"SELECT id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at, deleted_at FROM attachments WHERE memory_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
			)
			.bind(memoryId)
			.all<AttachmentRecord>();
		return results ?? [];
	}

	async insertAttachment(
		row: AttachmentRecord,
		spaceId: string,
		actor: string,
		now: number,
	): Promise<void> {
		const stmts = [
			this.deps.db
				.prepare(
					"INSERT INTO attachments (id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
				)
				.bind(
					row.id,
					row.memory_id,
					row.r2_key,
					row.filename,
					row.content_type,
					row.size_bytes,
					row.sha256,
					row.created_by,
					row.created_at,
				),
			this.deps.db
				.prepare(
					"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('attachment', ?, ?, 'created', NULL, ?, ?)",
				)
				.bind(row.id, spaceId, actor, now),
		];
		await this.deps.db.batch(stmts);
	}

	async softDelete(id: string, spaceId: string, actor: string, now: number): Promise<boolean> {
		const results = await this.deps.db.batch([
			this.deps.db
				.prepare("UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
				.bind(now, id),
			this.deps.db
				.prepare(
					`INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at)
					 SELECT 'attachment', ?, ?, 'trashed', NULL, ?, ?
					 WHERE changes() = 1`,
				)
				.bind(id, spaceId, actor, now),
		]);
		return (results[0]?.meta?.changes ?? 0) > 0;
	}
}
