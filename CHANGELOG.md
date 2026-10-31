# Changelog

## 0.8.0 — 2026-10-31

### Added

- Cache public author profiles by normalized-email SHA-256 hash in the Workers Cache API: 24 hours for hits, one hour for null profiles, and five minutes for upstream failures. Verify the signed-in profile through the existing Access-protected `GET /api/admin/whoami` endpoint, which returns email, actor, public name and avatar with `Cache-Control: no-store`. The third party receives only the hash, never the email.
- Exercise public-profile hits, null responses and broken avatars through a local server-side test double, including the published `architie@gmail.com` hash vector. Tests never call the real profile service.

### Changed

- Render the sidebar brand as lowercase `octo` and retain the public name/avatar once per SPA session, including concurrent loads. Missing names retain the verified email; failed or absent avatar images fall back to initials in the same fixed-size box with no referrer disclosure.
- Separate shared page titles from inline metadata using Basalt tokens. Keep memory clear/apply controls aligned with the filters on the row below the title, and align clear/apply with adjacent usage/audit filter fields inside their popovers.
- Show key names in daily usage tables and charts. Deleted or unknown keys use the first eight ID characters. Only the admin usage response adds `key_name`; the API-key-authenticated v1 response is unchanged.
- Fill the remaining desktop viewport with memory lists, spaces, keys, trash, usage and audit tables. Rows scroll internally while column headers and pagination remain visible; mobile pages keep natural document scrolling.

### Validation

- Strict TDD for profile caching, session loading, key labels and browser geometry; L1 retains all four coverage floors of 95%, strict typechecking, lint and every existing hook/gate.
- L2 verifies profile identity and admin-only usage metadata. Real-Worker Chromium tests cover profile hit/null/image failure, navigation request counts, heading/filter alignment, key deletion fallback, table scrolling, sticky headers and usable pagination across desktop/mobile states.
- No database migration, authentication change, production deployment or merge is included. Before/after 1440×900 screenshots are retained outside the repository.

## 0.7.0 — 2026-10-28

### Added

- `GET /api/admin/dashboard` returns one Access-only window of dashboard aggregates: memory operations by day × actor × space × operation, daily usage per key, active memory types per space, space counts with trash and sanitized key metadata. A `changes_at` index keeps the range aggregation off a full change-stream scan.

### Changed

- Rebuild the overview as an analytics desk: dual-axis time series for operations by type (with a net-growth line), operations per space, bot operations against API calls, and bot calls against error rate; side-by-side donut distributions for memory type, space and operation mix; and Top Bot / Top Space rankings whose rows open a detail sheet. Range (7/30/90 days) and selection stay in the URL, and the previous stat-only page, raw tables and feature-entry block are gone.
- Remove the duplicated header search icon. The command palette stays on the sidebar search field and `⌘K`.
- Render every timestamp in the browser's local zone through one formatter, `2026-09-30，13:42` without a zone label or seconds. Stored values remain UTC, and timeline grouping now uses local month, day and hour buckets so rows never sit under a UTC bucket.

### Validation

- One additive migration creates `changes_at`; no data rewrite or backfill is required.
- Dashboard aggregates cover both unit and L2 HTTP tests; the local demo database was inspected for the new charts before release.

## 0.6.2 — 2026-10-28

### Changed

- Let administrators rename API key agents independently of their automatically owned space. New automatic space slugs use the lowercase key ID instead of the agent name.
- Simplify key actions and dialogs, and add select-all and clear-all permission controls, including support for keys without operations.
- Update Hono, React Router, Lucide, Wrangler, Biome, Cloudflare Workers types, and oxc-parser.

### Security

- Pin the transitive `qs` dependency to 6.16.1 for GHSA-6pq8-jhm2-2vcw.

### Validation

- No schema or data migration is required. Existing spaces are not renamed.
- Verify key renaming, stable automatic space identifiers, permission selection, and desktop/mobile dialog layout against an isolated local Worker.

## 0.6.0 — 2026-10-26

### Added

- Immersive graph page: one full-height canvas inside the content island with a floating node directory, a floating inspector for the selected node's properties and neighbours, and a centred toolbar for zoom, labels, simulation and sheets.
- Search, kind and selection state for the graph live in the URL (`find`, `kind`, `node`), and the graph data tables move into a `图谱数据表` sheet.
- Graph viewmodel helpers: degrees, ranking, directory filtering, neighbours, one-hop focus, selected node and main connected component.

### Changed

- Page chrome collapses to a single row: the project `PageHeader` override keeps the `h1`, an inline meta line and one actions row, replacing Basalt's `description` and `filters` slots.
- Every header control uses Basalt's native 34px density; filters with many fields (usage, audit, search) live in popovers or inline panels behind one trigger, and list pages drop the section band that only named their table.
- The graph auto-fits the largest connected component when it holds at least half the nodes, sizes tags by memory count and damps node radius against the zoom level.

### Fixed

- Paint the graph ambience in device pixels so the gradient covers the whole canvas on 2x displays instead of its top-left quarter.
- Reach all four canvas edges with a primary-to-tag wash instead of a centred halo that died out before the frame.
- Keep the page title on one line above 768px and clamp it to two wrapped lines below, so long memory titles stay inside the reader column.
- Keep search options mounted without a force-mounted popover; the closed popover no longer steals focus from the query box and the `/` shortcut survives.
- Align the memory filter row, pager and usage/audit filter actions on one baseline.

### Validation

- L1 coverage 99.07% statements / 97.16% branches / 99.24% functions / 99.42% lines, strict typecheck and Biome with warnings as errors.
- L2 API suite 322 tests, L3 Chromium suite 121 tests including four new graph journeys.
- No database migration or authentication change is introduced.

## 0.5.2 — 2026-10-24

### Changed

- Bump `@cloudflare/workers-types`, `@modelcontextprotocol/sdk`, `@types/bun`, and `undici` (including miniflare transitive override).

### Security

- Pin transitive `body-parser` to 2.4.0 (GHSA-27r3-jxmh-p828).
- Pin transitive `fast-uri` to 3.1.9 (GHSA-333x-w4r6-6crp, GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h).

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
