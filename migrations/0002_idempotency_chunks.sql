CREATE TABLE IF NOT EXISTS idempotency_response_chunks (
  key_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  body TEXT NOT NULL,
  PRIMARY KEY (key_id, idem_key, chunk_index),
  FOREIGN KEY (key_id, idem_key) REFERENCES idempotency_records(key_id, idem_key) ON DELETE CASCADE
);
