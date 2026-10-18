import { tagTokenStatement, wordIndexStatements } from "./word-index";

export const WORD_BACKFILL_LIMIT = 100;
export const WORD_BACKFILL_BYTES = 1_048_576;

type State = { tag_cursor: string; memory_cursor: string; tags_done: number; complete: number };
type Memory = { id: string; title: string; body: string; version: number; updated_at: number };

async function state(db: D1Database): Promise<State> {
	const row = await db
		.prepare(
			"SELECT tag_cursor, memory_cursor, tags_done, complete FROM search_backfill_state WHERE id = 1",
		)
		.first<State>();
	if (!row) throw new Error("word backfill state is missing");
	return row;
}

export async function backfillWordIndex(
	db: D1Database,
): Promise<{ tags: number; memories: number; complete: boolean }> {
	let progress = await state(db);
	let tags = 0;
	if (progress.complete) return { tags, memories: 0, complete: true };
	if (!progress.tags_done) {
		const { results } = await db
			.prepare("SELECT id, name FROM tags WHERE id > ? ORDER BY id LIMIT ?")
			.bind(progress.tag_cursor, WORD_BACKFILL_LIMIT)
			.all<{ id: string; name: string }>();
		tags = results.length;
		const cursor = results.at(-1)?.id ?? progress.tag_cursor;
		await db.batch([
			...results.map((tag) => tagTokenStatement(db, tag.id, tag.name)),
			db
				.prepare(
					"UPDATE search_backfill_state SET tag_cursor = ?, tags_done = NOT EXISTS (SELECT 1 FROM tags WHERE id > ?) WHERE id = 1 AND tag_cursor = ? AND tags_done = 0",
				)
				.bind(cursor, cursor, progress.tag_cursor),
		]);
		progress = await state(db);
	}
	if (!progress.tags_done || tags === WORD_BACKFILL_LIMIT)
		return { tags, memories: 0, complete: Boolean(progress.complete) };
	const { results } = await db
		.prepare(`
WITH candidates AS MATERIALIZED (
  SELECT id, length(CAST(title AS BLOB)) + length(CAST(body AS BLOB)) AS bytes
  FROM memories WHERE id > ? AND deleted_at IS NULL ORDER BY id LIMIT ?
), bounded AS (
  SELECT id, SUM(bytes) OVER (ORDER BY id) AS bytes, ROW_NUMBER() OVER (ORDER BY id) AS position FROM candidates
)
SELECT m.id, m.title, m.body, m.version, m.updated_at FROM bounded JOIN memories m ON m.id = bounded.id
WHERE bounded.bytes <= ? OR bounded.position = 1 ORDER BY m.id`)
		.bind(progress.memory_cursor, WORD_BACKFILL_LIMIT - tags, WORD_BACKFILL_BYTES)
		.all<Memory>();
	const cursor = results.at(-1)?.id ?? progress.memory_cursor;
	await db.batch([
		...results.flatMap((row) => [
			db
				.prepare(
					"INSERT INTO memories_fts_map (memory_id, fts_rowid) SELECT id, (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM memories_fts_map) FROM memories WHERE id = ? AND version = ? AND updated_at = ? AND deleted_at IS NULL ON CONFLICT(memory_id) DO NOTHING",
				)
				.bind(row.id, row.version, row.updated_at),
			...wordIndexStatements(db, row),
		]),
		db
			.prepare(
				"UPDATE search_backfill_state SET memory_cursor = ?, complete = NOT EXISTS (SELECT 1 FROM memories WHERE id > ? AND deleted_at IS NULL) WHERE id = 1 AND memory_cursor = ? AND complete = 0",
			)
			.bind(cursor, cursor, progress.memory_cursor),
	]);
	return { tags, memories: results.length, complete: Boolean((await state(db)).complete) };
}
