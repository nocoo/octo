# Changelog

## 0.5.1 — 2026-10-23

### Changed

- Bump development and dashboard dependencies (Biome, Vite, Wrangler, workers types, oxc-parser, react-router, lucide-react).

### Security

- Pin transitive `ip-address` to 10.7.4 (GHSA-rxp7-6hxx-x8q5).

## 0.5.0 — 2026-10-21

### Added

- Add a checked-in, local-only demo catalogue with 90 synthetic memories across six spaces: 84 active records in pages of 50 and 34, plus six trashed records, varied tags, Markdown, attachments and version history.
- Provide a non-destructive demo importer that refuses remote resources and enabled embedding backfill, preserves existing records and never configures gateway credentials.

### Changed

- Upgrade the dashboard to Basalt 3.2.1, use monochrome sidebar icons and normalize page, section and card headings across all dashboard routes.
- Keep filters and actions in the page header, preserve a single content island and use native package card, table and sidebar geometry.

### Fixed

- Add a header-left Back action with real parent navigation on direct entry, nested settings breadcrumbs and filter restoration through browser history.
- Preserve router history state and unsaved-editor protection through TOC, Markdown, usage-table and keyboard skip navigation.
- Restore asynchronous chapter targets on reload and Back/Forward, including repeated Chinese fragments without duplicate history entries or modified-click scrolling.
- Keep embedding connection feedback fully visible on compact mobile viewports.

### Validation

- Expand unit and Chromium coverage for page hierarchy, URL state, keyboard navigation, chapter restoration and responsive feedback.
- No database migration or authentication change is introduced. Demo data remains local and contains no generated embeddings.

## 0.4.2 — 2026-10-20

### Changed

- Upgrade the dashboard to Basalt 3.2.0 and align toolbars, filters, pagination and responsive layouts with its examples.
- Refine tables with consistent number, date and file-size formatting, semantic badges, bounded long labels and visible row actions.
- Improve compact attachment empty states, mobile editor sizing, audit date filters and dark-theme controls.

### Fixed

- Format history event timestamps from their millisecond values and align graph table badges with canvas legend colors.
- Use categorical bars for API-key activity and measure virtualized audit rows to preserve table alignment.

### Validation

- Update Chromium assertions for Basalt 3.2.0 and verify populated dashboard routes across desktop/mobile and light/dark themes.
- No additional database migration or authentication change is introduced beyond 0.4.1.

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
