import type { VisibleSpaces } from "../auth/authorize";
import { chunkBoundParams } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { newUlid } from "../lib/ulid";

export type SpaceRow = {
	id: string;
	slug: string;
	name: string;
	description: string;
	owner_key_id: string | null;
	created_at: number;
	updated_at: number;
};

export type SpaceWithCount = SpaceRow & { memory_count: number };

export class SpaceRepo {
	constructor(private readonly db: D1Database) {}

	async listVisible(visible: VisibleSpaces): Promise<SpaceWithCount[]> {
		if (visible.kind === "ids" && visible.ids.length === 0) {
			return [];
		}
		const spaces: SpaceRow[] = [];
		const map = new Map<string, number>();
		if (visible.kind === "all") {
			const { results } = await this.db
				.prepare("SELECT * FROM spaces ORDER BY slug")
				.all<SpaceRow>();
			spaces.push(...results);
			const { results: counts } = await this.db
				.prepare(
					"SELECT space_id, COUNT(*) AS n FROM memories WHERE deleted_at IS NULL GROUP BY space_id",
				)
				.all<{ space_id: string; n: number }>();
			for (const row of counts) {
				map.set(row.space_id, Number(row.n));
			}
		} else {
			for (const ids of chunkBoundParams(visible.ids)) {
				const placeholders = ids.map(() => "?").join(",");
				const { results } = await this.db
					.prepare(`SELECT * FROM spaces WHERE id IN (${placeholders}) ORDER BY slug`)
					.bind(...ids)
					.all<SpaceRow>();
				spaces.push(...results);
				const { results: counts } = await this.db
					.prepare(
						`SELECT space_id, COUNT(*) AS n FROM memories WHERE deleted_at IS NULL AND space_id IN (${placeholders}) GROUP BY space_id`,
					)
					.bind(...ids)
					.all<{ space_id: string; n: number }>();
				for (const row of counts) {
					map.set(row.space_id, Number(row.n));
				}
			}
			spaces.sort((a, b) => a.slug.localeCompare(b.slug));
		}
		return spaces.map((space) => ({ ...space, memory_count: map.get(space.id) ?? 0 }));
	}

	async getVisibleBySlug(slug: string, visible: VisibleSpaces): Promise<SpaceWithCount | null> {
		const row = await this.db
			.prepare("SELECT * FROM spaces WHERE slug = ?")
			.bind(slug)
			.first<SpaceRow>();
		if (!row) {
			return null;
		}
		if (visible.kind === "ids" && !visible.ids.includes(row.id)) {
			return null;
		}
		const count = await this.db
			.prepare("SELECT COUNT(*) AS n FROM memories WHERE space_id = ? AND deleted_at IS NULL")
			.bind(row.id)
			.first<{ n: number }>();
		return { ...row, memory_count: count ? Number(count.n) : 0 };
	}
}

export async function ensureAutoOwnSpace(
	db: D1Database,
	key: { id: string; name: string; auto_own_space: number },
	now: () => number = Date.now,
	id: () => string = newUlid,
): Promise<SpaceRow | null> {
	if (!key.auto_own_space) {
		return null;
	}
	const owned = await db
		.prepare("SELECT * FROM spaces WHERE owner_key_id = ?")
		.bind(key.id)
		.first<SpaceRow>();
	if (owned) {
		return owned;
	}
	const ts = now();
	await db
		.prepare(
			"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING",
		)
		.bind(id(), key.name, key.name, "", key.id, ts, ts)
		.run();
	const row = await db
		.prepare("SELECT * FROM spaces WHERE slug = ?")
		.bind(key.name)
		.first<SpaceRow>();
	if (!row) {
		throw new ApiError("internal", "failed to ensure own space");
	}
	if (row.owner_key_id !== key.id) {
		throw new ApiError("unprocessable", "own space slug is taken");
	}
	return row;
}
