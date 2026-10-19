# Shell reference alignment

The reference is Giraffe revision
`7724f57377e10e257bbdcf2d520154da5eda1a7b`, using Basalt 3.1.0, the same
version installed by Octo. Octo keeps the standalone CSS contract; it does not
copy Giraffe's Tailwind configuration or repository-specific controls.

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

Octo preserves its own navigation, colorful icons, command palette, Access
identity/error handling, breadcrumb semantics and all four mobile header actions.
It retains its content grid and full-height empty-state layout rather than
copying Giraffe's page-specific containers. Markdown typography has a separate
[reading contract](markdown-reading.md).

`tests/e2e/shell.spec.ts` checks geometry, disclosure, collapsed search, mobile
focus return, theme changes and responsive insets against the isolated Worker.
`tests/e2e/empty-layout.spec.ts` checks that shell changes preserve empty-state
centering, viewport containment and actions.
