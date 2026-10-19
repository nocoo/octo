ALTER TABLE vector_sync_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vector_sync_jobs ADD COLUMN last_error TEXT;
ALTER TABLE vector_sync_jobs ADD COLUMN dead_at INTEGER;
ALTER TABLE vector_sync_jobs ADD COLUMN lease_dirty INTEGER NOT NULL DEFAULT 0;

DROP INDEX vector_sync_due;
CREATE INDEX vector_sync_due ON vector_sync_jobs(due_at, lease_until) WHERE dead_at IS NULL;

DROP TRIGGER vector_sync_memory_insert;
CREATE TRIGGER vector_sync_memory_insert AFTER INSERT ON memories
BEGIN
  INSERT INTO vector_sync_jobs (memory_id) VALUES (NEW.id)
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

DROP TRIGGER vector_sync_memory_update;
CREATE TRIGGER vector_sync_memory_update
AFTER UPDATE OF space_id, type, source_key_id, importance, created_at, updated_at, event_time, content_hash, version, deleted_at ON memories
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = NEW.id;
  INSERT INTO vector_sync_jobs (memory_id) VALUES (NEW.id)
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

DROP TRIGGER vector_sync_memory_delete;
CREATE TRIGGER vector_sync_memory_delete AFTER DELETE ON memories
BEGIN
  INSERT INTO vector_sync_jobs (memory_id) VALUES (OLD.id)
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

DROP TRIGGER vector_sync_vector_insert;
CREATE TRIGGER vector_sync_vector_insert AFTER INSERT ON memory_vectors
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = NEW.memory_id AND profile_id = NEW.profile_id;
  INSERT INTO vector_sync_jobs (memory_id) VALUES (NEW.memory_id)
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

DROP TRIGGER vector_sync_vector_update;
CREATE TRIGGER vector_sync_vector_update
AFTER UPDATE OF vector, content_hash, dim, profile_id, embedding_model, updated_at ON memory_vectors
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id = NEW.memory_id AND profile_id = NEW.profile_id;
  INSERT INTO vector_sync_jobs (memory_id) VALUES (NEW.memory_id)
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

DROP TRIGGER vector_sync_vector_delete;
CREATE TRIGGER vector_sync_vector_delete AFTER DELETE ON memory_vectors
BEGIN
  INSERT INTO vector_sync_jobs (memory_id) VALUES (OLD.memory_id)
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

DROP TRIGGER vector_sync_space_slug;
CREATE TRIGGER vector_sync_space_slug AFTER UPDATE OF slug ON spaces
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL WHERE memory_id IN (SELECT id FROM memories WHERE space_id = NEW.id);
  INSERT INTO vector_sync_jobs (memory_id) SELECT id FROM memories WHERE space_id = NEW.id
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;
