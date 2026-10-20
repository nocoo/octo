CREATE TRIGGER IF NOT EXISTS vector_sync_profile_insert AFTER INSERT ON embedding_profiles
WHEN NEW.active = 1
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL;
  INSERT INTO vector_sync_jobs (memory_id) SELECT id FROM memories WHERE true
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

CREATE TRIGGER IF NOT EXISTS vector_sync_profile_update
AFTER UPDATE OF model, dims, active, vectorize_index ON embedding_profiles
WHEN (OLD.active = 1 OR NEW.active = 1) AND
  (OLD.model IS NOT NEW.model OR OLD.dims IS NOT NEW.dims OR
   OLD.active IS NOT NEW.active OR OLD.vectorize_index IS NOT NEW.vectorize_index)
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL;
  INSERT INTO vector_sync_jobs (memory_id) SELECT id FROM memories WHERE true
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;

CREATE TRIGGER IF NOT EXISTS vector_sync_profile_delete AFTER DELETE ON embedding_profiles
WHEN OLD.active = 1
BEGIN
  UPDATE memory_vectors SET indexed_at = NULL;
  INSERT INTO vector_sync_jobs (memory_id) SELECT id FROM memories WHERE true
  ON CONFLICT(memory_id) DO UPDATE SET generation = generation + 1, due_at = 0,
    attempts = 0, last_error = NULL, dead_at = NULL;
END;
