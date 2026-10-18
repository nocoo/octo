import { indexText } from "./tokenizer";

export const WORD_TAGS_SQL =
	"IFNULL((SELECT GROUP_CONCAT(COALESCE(st.tokens, t.name), ' ') FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id LEFT JOIN search_tag_tokens st ON st.tag_id = t.id AND st.name = t.name WHERE mt.memory_id = m.id), '')";

export function tagTokenStatement(db: D1Database, id: string, name: string): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO search_tag_tokens (tag_id, name, tokens) SELECT id, name, ? FROM tags WHERE id = ? AND name = ? ON CONFLICT(tag_id) DO UPDATE SET name = excluded.name, tokens = excluded.tokens",
		)
		.bind(indexText(name), id, name);
}

export function wordIndexStatements(
	db: D1Database,
	row: { id: string; title: string; body: string; version: number; updated_at: number },
): D1PreparedStatement[] {
	const guard = "m.id = ? AND m.version = ? AND m.updated_at = ? AND m.deleted_at IS NULL";
	return [
		db
			.prepare(
				`DELETE FROM memories_words_fts WHERE rowid IN (SELECT map.fts_rowid FROM memories_fts_map map JOIN memories m ON m.id = map.memory_id WHERE ${guard})`,
			)
			.bind(row.id, row.version, row.updated_at),
		db
			.prepare(
				`INSERT INTO memories_words_fts(rowid, title, body, tags) SELECT map.fts_rowid, ?, ?, ${WORD_TAGS_SQL} FROM memories m JOIN memories_fts_map map ON map.memory_id = m.id WHERE ${guard}`,
			)
			.bind(indexText(row.title), indexText(row.body), row.id, row.version, row.updated_at),
	];
}
