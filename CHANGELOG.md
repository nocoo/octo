# Changelog

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
