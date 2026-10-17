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

	insertStatements(
		row: AttachmentRecord,
		spaceId: string,
		actor: string,
		now: number,
	): D1PreparedStatement[] {
		return [
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
	}

	softDeleteStatements(
		id: string,
		spaceId: string,
		actor: string,
		now: number,
	): D1PreparedStatement[] {
		// A stale snapshot violates NOT NULL to abort the entire HTTP-owned transaction.
		return [
			this.deps.db
				.prepare(
					`INSERT INTO attachments (id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at)
					 SELECT ?, '', '', NULL, '', 0, '', '', 0
					 WHERE NOT EXISTS (SELECT 1 FROM attachments WHERE id = ? AND deleted_at IS NULL)`,
				)
				.bind(id, id),
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
		];
	}
}
