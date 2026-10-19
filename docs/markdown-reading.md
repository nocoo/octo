# Markdown reading typography

The memory reader and editor preview share `components/layout/markdown.tsx` and
`markdown.css`. Reading typography stays inside `.octo-markdown`; application
controls, navigation, metadata and the source editor keep their existing fonts.

## Reference and font decision

The reference is his.fm's authenticated admin reader at revision
`4c81209bc28b52337075b80f011835cefe2647e1`:

- `apps/web/src/admin/production/production.css`: Charter/CJK serif reading,
  18px text, 1.65 line height, distinct heading and paragraph rhythm.
- `apps/web/public/admin/fonts/jinkai/NOTICE.md`: TsangerJinKai02 W04 belongs to
  Tsanger, is excluded from the code license, and is documented as personal-use
  only. Commercial use requires a separate vendor license.
- The notice traces the same WOFF2 subsets through GeekHub/Tw93's Weekly and a
  local X-Ray checkout. It reports 97 subsets totaling 4,287,644 bytes, used only
  in the authenticated, single-owner reader.

These are local repository statements, not an independently verified vendor
license. Authentication does not establish permission for SaaS distribution or
webfont embedding. Octo does not copy, bundle or request these font assets.
To adopt that exact face, first obtain permission explicitly covering Octo's
SaaS/webfont use, subsetting and distribution; alternatively evaluate a font
with verified open licensing in a separate change.

Octo uses only installed system faces: Charter/Georgia for Latin, Songti SC,
Noto Serif CJK SC, Source Han Serif SC or SimSun for Chinese, then generic serif.
No `@font-face`, font download, external stylesheet or new dependency is needed.
Actual glyphs and metrics vary with the operating system and installed fonts.

## Reading contract

- Retain the approximately 72ch width; center it within the available card.
- Use the Basalt 18px text token and reference reader's unitless 1.65 leading.
  All margins, padding and grid gaps use existing Basalt spacing tokens.
- Differentiate headings, paragraphs, nested lists, quotes, links, inline code
  and table headers without changing Markdown parsing or stored content.
- Preserve GFM, heading IDs/TOC, disabled task controls, safe URL transforms,
  signed attachment resolution, lazy images and syntax highlighting.
- Keep wide code/tables horizontally scrollable with X-only overscroll
  containment; do not intercept wheel/touch input or trap vertical scrolling.

Unit tests check markup/security invariants and scoped CSS declarations. The
browser specification checks typography, list/quote rhythm, overflow and font
scope at 390px/1440px in light/dark themes, for both reader and editor preview.
CSS source assertions are not browser or visual acceptance evidence; execute the
browser suite separately before release.
