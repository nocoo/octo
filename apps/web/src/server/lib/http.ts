export function isoUtc(ms: number): string {
	return new Date(ms).toISOString();
}

export function listEnvelope<T>(
	items: T[],
	nextCursor: string | null = null,
): {
	items: T[];
	next_cursor: string | null;
} {
	return { items, next_cursor: nextCursor };
}

export function serializeTag(tag: {
	id: string;
	name: string;
	display_name: string;
	use_count?: number;
	created_at?: number;
	updated_at?: number;
	merged_into?: string | null;
}): Record<string, unknown> {
	const body: Record<string, unknown> = {
		id: tag.id,
		name: tag.name,
		display_name: tag.display_name,
	};
	if (typeof tag.use_count === "number") {
		body.use_count = tag.use_count;
	}
	if (typeof tag.created_at === "number") {
		body.created_at = isoUtc(tag.created_at);
	}
	if (typeof tag.updated_at === "number") {
		body.updated_at = isoUtc(tag.updated_at);
	}
	if (tag.merged_into) {
		body.merged_into = tag.merged_into;
	}
	return body;
}

export function serializeSpace(space: {
	id: string;
	slug: string;
	name: string;
	description: string;
	owner_key_id: string | null;
	memory_count: number;
	created_at: number;
	updated_at: number;
}): Record<string, unknown> {
	return {
		id: space.id,
		slug: space.slug,
		name: space.name,
		description: space.description,
		owner_key_id: space.owner_key_id,
		memory_count: space.memory_count,
		created_at: isoUtc(space.created_at),
		updated_at: isoUtc(space.updated_at),
	};
}
