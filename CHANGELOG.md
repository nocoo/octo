# Changelog

## 0.2.0 — 2026-10-19

### Added

- Admin-role API keys can create, rename and delete empty spaces through REST and MCP. Slugs remain immutable in these interfaces; key and ownership management remain dashboard-only.
- Single and ordered batch memory moves support optional optimistic concurrency checks and require update permission in both spaces, including own-entry restrictions.
- Moves preserve memory IDs, version history, tag order, attachments and stored vectors. Source-space tombstones and destination events commit atomically with the memory change, and vector metadata synchronizes without embedding model calls.
- MCP tools `create_space`, `update_space`, `delete_space` and `move_memory` share REST services, permissions and audit semantics.

### Validation

- Regression coverage exercises transaction rollback, replay authorization, batch ordering, retained attachments and vectors, and immediate old-space read/search isolation.
- No database migration is required. This entry prepares the version only; publication and deployment are separate operations.
