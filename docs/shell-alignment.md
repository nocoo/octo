# Shell reference alignment

Octo uses the published `@nocoo/basalt@3.2.1` artifact, tag reference
`857b5a238ff8595c9998c2de7dad6144cd839c72`. The package's `ai/INTEGRATION.md`,
`ai/RECIPES.md`, declarations and compiled components define the current contract.
Octo keeps standalone CSS and app-owned routing, data and identity.

The original geometry comparison used Giraffe revision
`7724f57377e10e257bbdcf2d520154da5eda1a7b` with Basalt 3.1.0. It is historical
evidence, not a reason to override released component geometry.

Chrome computed-style comparison at 1440px established these shared dimensions:

| Element | Geometry / typography |
| --- | --- |
| Expanded / collapsed rail | 260px / 68px |
| Sidebar header / application header | 56px |
| Brand mark | 28px; stable horizontal center at 34px |
| Desktop title | 20px / 28.57px; semibold |
| Version pill | 11px / 13.2px; monospace |
| Sidebar search / items | 244px wide, 38px high |
| Navigation labels | 14px / 22px; group labels 11px |
| Identity avatar | 36px |
| Framework icon controls | 34px square |
| GitHub / project icons | 18px |
| Native theme icon | 14px |
| Body text | 14px / 20px |
| Island outer inset | 12px desktop; 8px mobile |

Coarse-pointer header controls retain the 44px touch-target minimum, including
the mobile menu. Rail toggles transfer keyboard focus to their replacement
button; the mobile drawer reports its own expanded state independently of the
desktop rail.

Collapse lives in the sidebar header; the collapsed rail has expand and search
controls. Basalt SidebarGroup owns group disclosure. Expanded identity uses
SidebarUser's native avatar placement rather than a custom rail-slot wrapper.
The logo keeps its center when the rail collapses; the expanded avatar follows
the reference's native inset and centers in the collapsed rail.

Octo preserves its own navigation, monochrome icons, command palette, Access
identity/error handling, breadcrumb semantics and all four mobile header actions.
It retains its content grid and full-height empty-state layout rather than
copying Giraffe's page-specific containers. Markdown typography has a separate
[reading contract](markdown-reading.md).

## Page hierarchy and navigation

- One `ContentIsland` owns the content surface and scroll behavior. Page grids
  only arrange content; they use the package's large layout gap without extra padding.
- Each page has one plain `PageHeader` title. The released standalone `3xl`
  token renders at 24px; guide prose mentioning 30px does not override the artifact.
- `SectionRule` heading variants identify page regions. Card headings use
  `LayerCard.Header` with semantic headings, retaining compact card typography.
  Bodies stay on their card surface; wells raise only nested content.
- Framework breadcrumbs show real ancestors and the current page once.
  Embedding settings include `/settings`; memory edit/history include their detail route.
- The header's left Back action follows browser history. Direct entry without
  an in-app history index falls back to the nearest real parent, never an external referrer.
  Editor navigation still passes through the unsaved-change guard.
- Filters, list/card view and pagination remain URL state. Applied filters push
  history, and Back/Forward restores the corresponding filter controls. Large filter
  panels reopen for restored active filters. Version comparisons live in header filters.
- Page actions belong in `PageHeader.actions`; Markdown content uses h3–h6 below
  the page h1 and card h2, preserving text and stable TOC IDs.
- Fragment links preserve router-owned history state and URL filters. The skip
  link moves focus without creating a history entry. The application owns scroll
  restoration: path changes reset to the top unless a fragment identifies a target;
  asynchronously loaded Markdown restores its chapter after rendering.

`tests/e2e/shell.spec.ts` checks geometry, disclosure, collapsed search, mobile
focus return, theme changes and responsive insets against the isolated Worker.
`tests/e2e/empty-layout.spec.ts` checks that shell changes preserve empty-state
centering, viewport containment and actions.
`tests/e2e/navigation-history.spec.ts` exercises URL round trips, direct-entry
parents, filter restoration and unsaved-editor Back behavior against the local Worker.
It also covers chapter reload/Back/Forward on desktop and mobile and keyboard skip
navigation before editing. Trusted Caddy/Chrome checks cover all 13 primary routes
at 390px/1440px in light/dark themes without disabling TLS verification.
