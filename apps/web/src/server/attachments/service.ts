import { type ApiPrincipal, authorize } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import type { BlobStore } from "../ports/blob";
import { sha256Hex } from "./crypto";
import { newUlid } from "./id";
import type { MemoryRow } from "./repo";
import { type AttachmentRepo, attachmentR2Key } from "./repo";
import { type AttachmentPublic, toPublicAttachment } from "./types";
import type { ParsedUpload } from "./upload";
import {
	buildSignedFileUrl,
	DEFAULT_ATTACHMENT_URL_TTL_SECONDS,
	signAttachmentUrl,
} from "./url-sign";

export type AttachmentWrite<T> = {
	statements: D1PreparedStatement[];
	value: T;
	mapError: (error: unknown) => ApiError | undefined | Promise<ApiError | undefined>;
};

export type AttachmentServiceDeps = {
	repo: AttachmentRepo;
	blobs: BlobStore;
	urlSecret: string;
	publicOrigin: string;
	ttlSeconds: number;
	now?: () => number;
};

type AuthOp = "read" | "update" | "delete";

function requireMemoryAccess(key: ApiPrincipal, op: AuthOp, memory: MemoryRow): void {
	if (memory.deleted_at !== null) {
		throw new ApiError("not_found", "not found");
	}
	const result = authorize(key, op, {
		spaceId: memory.space_id,
		sourceKeyId: memory.source_key_id,
	});
	if (result.allow) {
		return;
	}
	throw new ApiError(result.reason, result.reason);
}

export class AttachmentService {
	private readonly now: () => number;

	constructor(private readonly deps: AttachmentServiceDeps) {
		this.now = deps.now ?? (() => Date.now());
	}

	private actor(key: ApiPrincipal): string {
		return `key:${key.id}`;
	}

	private async loadMemory(memoryId: string): Promise<MemoryRow> {
		const memory = await this.deps.repo.getMemory(memoryId);
		if (!memory) {
			throw new ApiError("not_found", "not found");
		}
		return memory;
	}

	async assertUploadAccess(key: ApiPrincipal, memoryId: string): Promise<void> {
		const memory = await this.loadMemory(memoryId);
		requireMemoryAccess(key, "update", memory);
	}

	async assertDeleteAccess(key: ApiPrincipal, attachmentId: string): Promise<void> {
		const attachment = await this.deps.repo.getAttachment(attachmentId);
		if (!attachment) throw new ApiError("not_found", "not found");
		const memory = await this.loadMemory(attachment.memory_id);
		requireMemoryAccess(key, "delete", memory);
	}

	async upload(
		key: ApiPrincipal,
		memoryId: string,
		upload: ParsedUpload,
	): Promise<AttachmentWrite<AttachmentPublic>> {
		const memory = await this.loadMemory(memoryId);
		requireMemoryAccess(key, "update", memory);
		const now = this.now();
		const id = newUlid(now);
		const sha256 = await sha256Hex(upload.bytes);
		const row = {
			id,
			memory_id: memory.id,
			r2_key: attachmentR2Key(memory.id, id),
			filename: upload.filename,
			content_type: upload.contentType,
			size_bytes: upload.bytes.byteLength,
			sha256,
			created_by: this.actor(key),
			created_at: now,
			deleted_at: null,
		};
		const statements = this.deps.repo.insertStatements(row, memory.space_id, this.actor(key), now);
		await this.deps.blobs.put(row.r2_key, upload.bytes, {
			contentType: upload.contentType,
			sha256,
		});
		return {
			statements,
			value: toPublicAttachment(row, true),
			mapError: async () => {
				const persisted = await this.deps.repo.getAttachment(id).catch(() => undefined);
				if (persisted === null) {
					await this.deps.blobs.delete(row.r2_key);
				}
				return new ApiError("unavailable", "upload transaction failed");
			},
		};
	}

	async list(key: ApiPrincipal, memoryId: string): Promise<AttachmentPublic[]> {
		const memory = await this.loadMemory(memoryId);
		requireMemoryAccess(key, "read", memory);
		const rows = await this.deps.repo.listForMemory(memoryId);
		return rows.map((row) => toPublicAttachment(row));
	}

	async signedUrl(
		key: ApiPrincipal,
		attachmentId: string,
	): Promise<{ url: string; expires_at: string }> {
		const attachment = await this.deps.repo.getAttachment(attachmentId);
		if (!attachment || attachment.deleted_at !== null) {
			throw new ApiError("not_found", "not found");
		}
		const memory = await this.loadMemory(attachment.memory_id);
		requireMemoryAccess(key, "read", memory);
		const exp =
			Math.floor(this.now() / 1000) + (this.deps.ttlSeconds || DEFAULT_ATTACHMENT_URL_TTL_SECONDS);
		const sig = await signAttachmentUrl(this.deps.urlSecret, attachment.r2_key, exp);
		return {
			url: buildSignedFileUrl(this.deps.publicOrigin, attachment.r2_key, exp, sig),
			expires_at: new Date(exp * 1000).toISOString(),
		};
	}

	async delete(key: ApiPrincipal, attachmentId: string): Promise<AttachmentWrite<void>> {
		const attachment = await this.deps.repo.getAttachment(attachmentId);
		if (!attachment || attachment.deleted_at !== null) {
			throw new ApiError("not_found", "not found");
		}
		const memory = await this.loadMemory(attachment.memory_id);
		requireMemoryAccess(key, "delete", memory);
		return {
			statements: this.deps.repo.softDeleteStatements(
				attachmentId,
				memory.space_id,
				this.actor(key),
				this.now(),
			),
			value: undefined,
			mapError: (err) =>
				String(err).includes("NOT NULL constraint failed: attachments.filename")
					? new ApiError("not_found", "not found")
					: undefined,
		};
	}
}
