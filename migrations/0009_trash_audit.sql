CREATE TABLE IF NOT EXISTS audit_bulk_counts (
  audit_id TEXT PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE,
  requested_count INTEGER NOT NULL CHECK (requested_count >= 0),
  succeeded_count INTEGER NOT NULL CHECK (succeeded_count >= 0),
  failed_count INTEGER NOT NULL CHECK (failed_count >= 0)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS changes_entity_seq ON changes(entity, entity_id, seq);
