ALTER TABLE vector_sync_jobs ADD COLUMN visible_generation INTEGER;

CREATE TABLE embedding_cache (
  cache_key TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memory_embedding_calls (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (memory_id, profile_id)
);
