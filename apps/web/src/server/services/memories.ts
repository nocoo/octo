import type { MemoryCreate, MemoryPatch } from "../../lib/schema/memory";

export type MemoryRecord = {
	id: string;
	space: string;
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
	keyId: string;
	actor: string;
};

export type MemoryServiceError = {
	code: "validation_failed" | "not_found" | "version_conflict" | "forbidden";
	message: string;
	details?: Record<string, unknown>;
};

export interface MemoryService {
	get(id: string, ctx: MemoryServiceContext): Promise<MemoryRecord | null>;
	create(input: MemoryCreate, ctx: MemoryServiceContext): Promise<MemoryRecord>;
	update(
		id: string,
		patch: MemoryPatch & { expected_version: number },
		ctx: MemoryServiceContext,
	): Promise<MemoryRecord>;
	delete(id: string, ctx: MemoryServiceContext): Promise<{ trashed_at: string }>;
}
