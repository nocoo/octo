CREATE TABLE IF NOT EXISTS external_file_cleanup_jobs (
  r2_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
