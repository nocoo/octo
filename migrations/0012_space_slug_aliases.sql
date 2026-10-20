CREATE TABLE IF NOT EXISTS space_slug_aliases (
  slug TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS space_slug_aliases_space ON space_slug_aliases(space_id);
CREATE INDEX IF NOT EXISTS space_slug_aliases_expiry ON space_slug_aliases(expires_at);

CREATE TRIGGER IF NOT EXISTS space_slug_insert_guard BEFORE INSERT ON spaces
WHEN EXISTS (
  SELECT 1 FROM space_slug_aliases
  WHERE slug = NEW.slug AND space_id != NEW.id
    AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT, 'space slug alias conflict');
END;

CREATE TRIGGER IF NOT EXISTS space_slug_update_guard BEFORE UPDATE OF slug ON spaces
WHEN OLD.slug != NEW.slug AND EXISTS (
  SELECT 1 FROM space_slug_aliases
  WHERE slug = NEW.slug AND space_id != NEW.id
    AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT, 'space slug alias conflict');
END;

CREATE TRIGGER IF NOT EXISTS space_slug_alias_record AFTER UPDATE OF slug ON spaces
WHEN OLD.slug != NEW.slug
BEGIN
  DELETE FROM space_slug_aliases WHERE slug = NEW.slug;
  INSERT INTO space_slug_aliases (slug, space_id, created_at, expires_at)
  VALUES (OLD.slug, NEW.id, NEW.updated_at, NEW.updated_at + 2592000000)
  ON CONFLICT(slug) DO UPDATE SET
    space_id = excluded.space_id,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at;
END;
