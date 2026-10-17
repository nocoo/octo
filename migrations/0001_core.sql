CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_key_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  source_key_id TEXT NOT NULL,
  updated_by_key_id TEXT,
  event_time INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX memories_space_updated ON memories(space_id, updated_at);
CREATE INDEX memories_deleted ON memories(deleted_at);
CREATE INDEX memories_type ON memories(type);
CREATE INDEX memories_event_time ON memories(event_time);

CREATE TABLE memory_versions (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  importance REAL NOT NULL,
  tags_json TEXT NOT NULL,
  event_time INTEGER,
  space_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  op TEXT NOT NULL,
  rollback_of INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, version)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  merged_into TEXT REFERENCES tags(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE memory_tags (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (memory_id, tag_id)
);
CREATE INDEX memory_tags_tag ON memory_tags(tag_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE embedding_profiles (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL CHECK (dims BETWEEN 1 AND 1536),
  metric TEXT NOT NULL DEFAULT 'cosine',
  vectorize_index TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE memory_vectors (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  profile_id TEXT NOT NULL REFERENCES embedding_profiles(id),
  embedding_model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  indexed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, profile_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  ciphertext BLOB,
  iv BLOB,
  key_version INTEGER,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  space_id TEXT,
  op TEXT NOT NULL,
  version INTEGER,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX changes_space_seq ON changes(space_id, seq);

CREATE TABLE idempotency_records (
  key_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key_id, idem_key)
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  prev_secret_hash TEXT,
  prev_valid_until INTEGER,
  role TEXT NOT NULL,
  ops TEXT NOT NULL,
  scope TEXT NOT NULL,
  space_ids_json TEXT NOT NULL DEFAULT '[]',
  own_entries_only INTEGER NOT NULL DEFAULT 0,
  auto_own_space INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  error_code TEXT,
  space_id TEXT,
  entity_id TEXT,
  request_id TEXT NOT NULL,
  idem_key TEXT,
  duration_ms INTEGER NOT NULL,
  bytes_in INTEGER,
  bytes_out INTEGER,
  ip_hash TEXT,
  user_agent TEXT
);
CREATE INDEX audit_at ON audit_log(at);
CREATE INDEX audit_actor_at ON audit_log(actor, at);

CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  key_id TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  writes INTEGER NOT NULL DEFAULT 0,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key_id)
);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, body, tags,
  content='', contentless_delete=1,
  tokenize='trigram remove_diacritics 1'
);

CREATE TABLE memories_fts_map (
  memory_id TEXT PRIMARY KEY,
  fts_rowid INTEGER UNIQUE
);

INSERT INTO embedding_profiles (id, model, dims, metric, vectorize_index, active, created_at)
VALUES ('te3-small-1536', 'text-embedding-3-small', 1536, 'cosine', 'octo-vec-te3-small-1536', 1, 1);
