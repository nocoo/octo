CREATE VIRTUAL TABLE IF NOT EXISTS memories_words_fts USING fts5(
  title, body, tags,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TABLE IF NOT EXISTS search_tag_tokens (
  tag_id TEXT PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tokens TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_backfill_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tag_cursor TEXT NOT NULL DEFAULT '',
  memory_cursor TEXT NOT NULL DEFAULT '',
  tags_done INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO search_backfill_state (id) VALUES (1);
