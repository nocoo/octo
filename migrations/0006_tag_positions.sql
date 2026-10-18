ALTER TABLE memory_tags ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT mt.memory_id, mt.tag_id,
    ROW_NUMBER() OVER (PARTITION BY mt.memory_id ORDER BY t.name, t.id) - 1 AS position
  FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id
)
UPDATE memory_tags SET position = (
  SELECT ordered.position FROM ordered
  WHERE ordered.memory_id = memory_tags.memory_id AND ordered.tag_id = memory_tags.tag_id
);
