# Changelog

## 0.5.0 — 2026-10-20

### Added

- Rename space slugs through REST, MCP and the dashboard without changing ID-bound key permissions, ownership, memories, versions or attachments.
- Resolve former slugs for 30 days, reject live-alias collisions with field-level errors, allow renaming back, and remove aliases when a space is deleted.
- Expose space ETags and optional If-Match concurrency checks; stale updates return 412. Dashboard edits submit the current token and display Chinese slug validation errors.
- Add legacy-data migration fixtures, scoped-key HTTP contracts, and real-browser persistence and error journeys.

### Changed

- MCP `update_space` now requires `space` as the target selector; optional `slug` is the new slug, and optional `if_match` uses the space's updated-at millisecond token. Update callers from the previous `{slug, name?, description?}` shape; no compatibility selector remains.
- Retain existing Vectorize slug metadata with transactional invalidation, resynchronization and D1 authorization rechecks; no new remote metadata index is required.

### Migration

- Apply `0012_space_slug_aliases.sql` before running the new Worker. It adds aliases and atomic collision/lifecycle triggers; existing ID-based data and permissions are preserved without rewrites. No remote migration or deployment is performed by this change.

## 0.4.1 — 2026-10-20

### Fixed

- Batch ready Vectorize upserts into at most 100 records per call, retaining per-job leases, acknowledgements, generation checks and write-time priority over slow embedding work.
- Retry rate-limited upserts and deletes twice with bounded exponential jitter. Persistent throttling reschedules jobs after 60–120 seconds without spending the failure budget or moving jobs toward the dead state.
- Stop hourly rewrites of acknowledged generations while continuing visibility checks and invalidation-driven synchronization for writes, moves, restores and profile changes.
- Fence claims and acknowledgements against an in-flight switch of the active embedding profile.
- Requeue missing or stale vectors when backfill is enabled, without rewriting already current client vectors.

### Migration

- Apply `0011_vector_profile_invalidation.sql` before deploying: active embedding profile changes and enabling backfill now requeue affected memories atomically. No remote migration or deployment is performed by this change.

## 0.4.0 — 2026-10-19

### Changed

- Dashboard empty states fill available page height with larger centered content, while embedded cards retain compact minimum heights and mobile tables keep actions visible.
- Align the application shell with Giraffe's Basalt 3.1.0 geometry: sidebar branding, monospace version pill, collapsible navigation groups, native avatar placement, header controls and responsive content insets.
- Move sidebar collapse/expand controls into the rail and provide direct command-palette access from the collapsed rail, retaining keyboard navigation and mobile focus restoration.
- Give Markdown readers and editor previews dedicated system serif typography, improved heading/list/quote rhythm, clearer inline code and links, and contained horizontal scrolling for wide content.
- Preserve attachment URL safety, GFM, syntax highlighting and table-of-contents navigation. Do not distribute his.fm's personal-use-only font assets; reading fonts resolve from the operating system.

### Validation

- Add Chromium coverage for empty-state geometry, shell dimensions and disclosure, plus reader/editor typography across desktop/mobile and light/dark themes.
- No database migration, authentication change or new dependency is required.

## 0.3.0 — 2026-10-19

### Added

- Admin-role API keys can create, rename and delete empty spaces through REST and MCP. Slugs remain immutable in these interfaces; key and ownership management remain dashboard-only.
- Single and ordered batch memory moves support optional optimistic concurrency checks and require update permission in both spaces, including own-entry restrictions.
- Moves preserve memory IDs, version history, tag order, attachments and stored vectors. Source-space tombstones and destination events commit atomically with the memory change, and vector metadata synchronizes without embedding model calls.
- MCP tools `create_space`, `update_space`, `delete_space` and `move_memory` share REST services, permissions and audit semantics.
- The dashboard can rename spaces with field-level validation, accessible keyboard focus and persistent names after reload.

### Validation

- Regression coverage exercises transaction rollback, replay authorization, batch ordering, retained attachments and vectors, and immediate old-space read/search isolation.
- No database migration is required. This entry prepares the version only; publication and deployment are separate operations.
