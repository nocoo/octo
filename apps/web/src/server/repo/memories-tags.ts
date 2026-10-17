import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";

export const TAG_NAME_MAX = 64;

export type TagRef = {
	id: string;
	name: string;
	display_name: string;
	merged_into: string | null;
};

export interface TagRepo {
	resolveMany(names: string[]): Promise<TagRef[]>;
	lookupMany(names: string[]): Promise<TagRef[]>;
}

export function normalizeTag(raw: string): string {
	const name = raw
		.trim()
		.normalize("NFKC")
		.replace(/\p{Script=Latin}/gu, (ch) => ch.toLowerCase());
	if (name.length < 1 || name.length > TAG_NAME_MAX) {
		throw new ApiError("validation_failed", "tag name must be 1-64 characters after normalize");
	}
	return name;
}

export function tagDisplayName(raw: string): string {
	const display = raw.trim().normalize("NFKC");
	if (display.length < 1 || display.length > TAG_NAME_MAX) {
		throw new ApiError("validation_failed", "tag name must be 1-64 characters after normalize");
	}
	return display;
}

export class InlineTagRepo implements TagRepo {
	constructor(
		private readonly db: D1Database,
		private readonly now: () => number = Date.now,
		private readonly id: () => string = newUlid,
	) {}

	async getByName(name: string): Promise<TagRef | null> {
		return this.db.prepare("SELECT * FROM tags WHERE name = ?").bind(name).first<TagRef>();
	}

	async getById(id: string): Promise<TagRef | null> {
		return this.db.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first<TagRef>();
	}

	async follow(row: TagRef): Promise<TagRef> {
		const seen = new Set<string>();
		let current = row;
		while (current.merged_into) {
			if (seen.has(current.id)) {
				throw new ApiError("unprocessable", "tag merge cycle");
			}
			seen.add(current.id);
			const next = await this.getById(current.merged_into);
			if (!next) {
				throw new ApiError("unprocessable", "tag redirect is broken");
			}
			current = next;
		}
		return current;
	}

	async lookupMany(rawNames: string[]): Promise<TagRef[]> {
		const resolved: TagRef[] = [];
		const seen = new Set<string>();
		for (const raw of rawNames) {
			const name = normalizeTag(raw);
			const row = await this.getByName(name);
			if (!row) {
				continue;
			}
			const canonical = await this.follow(row);
			if (!seen.has(canonical.id)) {
				seen.add(canonical.id);
				resolved.push(canonical);
			}
		}
		return resolved;
	}

	async resolveMany(rawNames: string[]): Promise<TagRef[]> {
		const resolved: TagRef[] = [];
		const seen = new Set<string>();
		for (const raw of rawNames) {
			const name = normalizeTag(raw);
			const display = tagDisplayName(raw);
			const id = this.id();
			const ts = this.now();
			await this.db
				.prepare(
					"INSERT OR IGNORE INTO tags (id, name, display_name, merged_into, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
				)
				.bind(id, name, display, ts, ts)
				.run();
			const row = await this.getByName(name);
			if (!row) {
				throw new ApiError("internal", "failed to resolve tag");
			}
			const canonical = await this.follow(row);
			if (!seen.has(canonical.id)) {
				seen.add(canonical.id);
				resolved.push(canonical);
			}
		}
		return resolved;
	}
}
