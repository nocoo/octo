import type { MemoryCreate, MemoryPatch } from "../../lib/schema/memory";
import { ApiError } from "../lib/errors";
import type {
	MemoryRecord,
	MemoryService,
	MemoryServiceContext,
	MemoryServiceError,
} from "./memories";

function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/u, ".000Z");
}

function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `01${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 26);
}

export class StubMemoryService implements MemoryService {
	private readonly store = new Map<string, MemoryRecord>();

	async create(input: MemoryCreate, _ctx: MemoryServiceContext): Promise<MemoryRecord> {
		const id = newId();
		const ts = nowIso();
		const record: MemoryRecord = {
			id,
			space: input.space,
			title: input.title,
			body: input.body,
			type: input.type,
			tags: input.tags,
			importance: input.importance ?? 0.5,
			version: 1,
			created_at: ts,
			updated_at: ts,
		};
		this.store.set(id, record);
		return record;
	}

	async update(
		id: string,
		patch: MemoryPatch & { expected_version: number },
		_ctx: MemoryServiceContext,
	): Promise<MemoryRecord> {
		const existing = this.store.get(id);
		if (!existing) {
			throw serviceError("not_found", "memory not found");
		}
		if (existing.version !== patch.expected_version) {
			throw serviceError("version_conflict", "version mismatch", {
				current_version: existing.version,
			});
		}
		const updated: MemoryRecord = {
			...existing,
			space: patch.space ?? existing.space,
			title: patch.title ?? existing.title,
			body: patch.body ?? existing.body,
			type: patch.type ?? existing.type,
			tags: patch.tags ?? existing.tags,
			importance: patch.importance ?? existing.importance,
			version: existing.version + 1,
			updated_at: nowIso(),
		};
		this.store.set(id, updated);
		return updated;
	}

	async delete(id: string, _ctx: MemoryServiceContext): Promise<{ trashed_at: string }> {
		if (!this.store.has(id)) {
			throw serviceError("not_found", "memory not found");
		}
		this.store.delete(id);
		return { trashed_at: nowIso() };
	}
}

function serviceError(
	code: MemoryServiceError["code"],
	message: string,
	details?: Record<string, unknown>,
): ApiError {
	return new ApiError(code, message, details ?? null);
}
