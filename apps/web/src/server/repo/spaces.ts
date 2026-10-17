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

	async listVisible(ids: string[]): Promise<SpaceWithCount[]> {
		if (ids.length === 0) {
			return [];
		}
		const placeholders = ids.map(() => "?").join(",");
		const { results } = await this.db
			.prepare(`SELECT * FROM spaces WHERE id IN (${placeholders}) ORDER BY slug`)
			.bind(...ids)
			.all<SpaceRow>();
		const spaces = results;
		const { results: counts } = await this.db
			.prepare(
				`SELECT space_id, COUNT(*) AS n FROM memories WHERE deleted_at IS NULL AND space_id IN (${placeholders}) GROUP BY space_id`,
			)
			.bind(...ids)
			.all<{ space_id: string; n: number }>();
		const map = new Map(counts.map((row) => [row.space_id, Number(row.n)]));
		return spaces.map((space) => ({ ...space, memory_count: map.get(space.id) ?? 0 }));
	}

	async getVisibleBySlug(slug: string, ids: string[]): Promise<SpaceWithCount | null> {
		const row = await this.db
			.prepare("SELECT * FROM spaces WHERE slug = ?")
			.bind(slug)
			.first<SpaceRow>();
		if (!row || !ids.includes(row.id)) {
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
	const bySlug = await db
		.prepare("SELECT * FROM spaces WHERE slug = ?")
		.bind(key.name)
		.first<SpaceRow>();
	if (bySlug) {
		throw new ApiError("unprocessable", "own space slug is taken");
	}
	const ts = now();
	const row: SpaceRow = {
		id: id(),
		slug: key.name,
		name: key.name,
		description: "",
		owner_key_id: key.id,
		created_at: ts,
		updated_at: ts,
	};
	await db
		.prepare(
			"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.bind(
			row.id,
			row.slug,
			row.name,
			row.description,
			row.owner_key_id,
			row.created_at,
			row.updated_at,
		)
		.run();
	return row;
}
