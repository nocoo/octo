# M3 — tags & spaces
Read: docs/02-data-model.md §5, docs/04-api.md (标签与 space), docs/05 §4.
Dirs: apps/web/src/server/repo/tags*, repo/spaces*, routes/v1/tags*, routes/v1/spaces*, tests/api/tags*, tests/api/spaces*.
Deliver: tag normalization (trim, NFKC, lowercase Latin, keep CJK, length 1–64) as pure function with tests; TagRepo.resolveMany (create-or-get, follows merged_into redirects); GET /tags with counts filtered by visible spaces; POST /tags/:name/rename (409 tag_conflict suggesting merge); POST /tags/:name/merge (one batch: move memory_tags with dedupe, set merged_into, one changes row op=tag_merged per affected memory, no new memory version); GET /spaces, GET /spaces/:slug (visible only, counts); auto_own_space creation helper (slug = lowercase key id) used on first write.
