# Octo

Private, API-first memory / knowledge-base SaaS on Zheng's Cloudflare account, replacing Nowledge Mem.

Direction: [design docs index](docs/README.md) (Chinese). Frameworks must not rewrite this file.

## Scope and instruction sources

- This file is the only project handbook. Do not create a `CLAUDE.md` alias or copy.
- Contract lives here and in `docs/`; hooks, CI and configuration must enforce it once code exists. Raise weaker enforcement instead of lowering the contract.
- Machine rules: global `AGENTS.md` and `rules/` in the workflow repo. Accident narratives: [Retrospective.md](Retrospective.md).

## Project invariants

- Single Hono Worker serving `/api/v1/*` (API-key auth), `/api/admin/*` + SPA (Cloudflare Access) and `/mcp` (the same API keys). MCP uses official SDK 1.32.1, fresh Web Standard Streamable HTTP transports per request, JSON responses and no sessions; contract and bot setup: [docs/09-mcp.md](docs/09-mcp.md). No Durable Objects. No rate limiting.
- Production `https://octo.hexly.ai` (`workers_dev = false`); local `https://octo.dev.hexly.ai` via Caddy.
- Access: verify `Cf-Access-Jwt-Assertion` against `https://nocoo.cloudflareaccess.com` JWKS, `iss` and AUD `9ab761cf…88d67` (code constants in `server/lib/access-config.ts` as in giraffe; not secrets; env overrides only in tests). `/api/v1/*` and `/mcp` bypass Access and use Worker-verified API keys.
- D1 `octo-db` is the source of truth; Vectorize is a derived index rebuilt from vectors stored in D1; R2 `octo-files` holds attachments.
- API keys are stored as HMAC hashes only; plaintext appears once at mint/rotate and never in logs, URLs, D1 or browser storage. No key or permission management through `/api/v1`.
- Default deny; out-of-scope spaces are invisible (404, absent from lists/search/counts). Every call is audited without bodies or keys.
- Delete moves to trash and is never auto-purged; hard delete exists only in the dashboard.
- Every memory write is one D1 batch: row, version snapshot, tags, FTS, change event (see docs/02 §3).
- Tests never use remote Cloudflare resources or deploy `-test` resources; Vectorize is replaced locally by the D1 brute-force `VectorStore`.
- Embedding gateway settings (base URL, AES-GCM-encrypted API key under `OCTO_SETTINGS_KEY`, model, dims, backfill toggle default off) are dashboard/Access-only and never exposed via `/api/v1`; outbound embedding calls always send a User-Agent.
- Dashboard uses only `@nocoo/basalt@3.2.1` controls; MVVM with the single `fetch` in `src/client/lib/api.ts`.
- Timestamps are stored in UTC and displayed only through `formatTimestamp` in `src/client/lib/format.ts`: browser-local `2026-09-30，13:42`, never a zone label, never a second formatter. UTC calendar-day buckets (usage, dashboard ranges) stay UTC days.
- Page headings keep `h1` + inline meta with token spacing; view switches and primary actions stay in `PageHeader.actions`. Memory filters and their clear action share the next row; larger filter sets stay together in popovers. Use consistent native 34px control density. Full-page tables fill the remaining desktop height with internal scrolling and visible headers/pagination. Never use Basalt's `description`/`filters` slots, a `Field` label row inside a toolbar, or a `SectionRule` heading that only names the single table below it; see docs/06 §8.

## Setup and commands

Bun 1.4, TypeScript 7 strict, Hono, Vite 8, Biome 2.5, Vitest 5 + V8 coverage, Husky. Install with a temporary registry (`BUN_CONFIG_REGISTRY=… bun install`); never set a global bun registry.

```
bun run dev              # Vite 127.0.0.1:7059 + wrangler sidecar 37059
bun run seed:demo        # Local-only: 84 active memories + 6 trash; docs/local-demo-seed.md
bun run typecheck
bun run lint             # biome check --error-on-warnings
bun run test:coverage    # L1, four metrics ≥95%
bun run test:e2e:api     # L2 direct Miniflare/workerd HTTP on 17059
bun run test:e2e:bdd     # L3 real Chromium on 27059
bun run gate:test-skip
bun run gate:no-remote
bun run gate:wrangler-vars
bun run gate:client-fetch
bun run gate:client-design # Basalt containers/controls and token-only spacing
bun run gate:production   # Empty Access bypass in production build inputs
bun run gate:security    # gitleaks + osv-scanner; missing tools fail
```

## Testing and quality contract

Strict TDD; atomic Conventional Commits staging explicit paths; never `--no-verify`; do not push unless Zheng asks.

| Dimension | Required proof | Status |
|---|---|---|
| L1 pre-commit | Statements/branches/functions/lines each ≥95%, no skipped/focused tests, strict typecheck, Biome `--error-on-warnings`, on the index snapshot <30s | enforced |
| L2 API | Direct Miniflare/workerd HTTP over 100% endpoint × method, success/failure/auth, including finite oversize uploads | enforced |
| L3 UI | Critical dashboard journeys in Chromium on isolated local Worker | CI gate; real admin integration covered |
| G2 security | gitleaks over pushed ranges + osv-scanner on `bun.lock` | enforced |
| D1 isolation | Per-run local persistence and ports, local-mode assertion, `_test_marker env=test` before fixtures/cleanup | enforced |

Details: [docs/07-dev-workflow.md](docs/07-dev-workflow.md).

## Release, CI and deploy

- Release: no release script. Version lives only in root `package.json` (`X.Y.Z`); tags and GitHub Releases use `vX.Y.Z`. Usually bump Z, Y for feature changes, X only with Zheng's approval. Manual cut per the workflow `nocoo-repo-steward` versioning reference: bump `package.json`, `bun install` to sync `bun.lock`, update root `CHANGELOG.md` (create it on the first release; no tags exist yet) from commits since the last tag, commit through hooks, push, then `git tag vX.Y.Z && git push origin vX.Y.Z` and `gh release create vX.Y.Z`. Release only when Zheng asks or another bot needs the change.
- CI (`.github/workflows/ci.yml`, push and PR to `main`, via `nocoo/base-ci` `quality.yml`): gates `test-skip`, `no-remote`, `wrangler-vars`, `client-fetch`; typecheck; Biome lint; `test:coverage` (≥95%); build (`bun run build` incl. `gate:production`, plus `wrangler deploy --dry-run`); L2 `test:e2e:api`; L3 `test:e2e:bdd`. Merge only when green.
- Deploy: Cloudflare Worker `octo` at `https://octo.hexly.ai` (custom domain, D1 `octo-db`, R2 `octo-files`, Vectorize). Deploy with wrangler from the MacBook (Studio has no wrangler login) out of a fresh worktree at remote `main` (confirm with `git ls-remote`): apply pending migrations with `wrangler d1 migrations apply octo-db --remote` before dependent code, then `wrangler deploy`, then verify `/api/live` reports the deployed `git_sha`. Never print secrets.

## Resources and isolation

| Lane | Ports (approved 2026-10-17, nmem `octo-local-ports`) | Boundary |
|---|---|---|
| Daily dev | Vite 7059, Worker 37059 | Caddy `octo.dev.hexly.ai`; local D1/R2 |
| L2 | 17059 (direct Miniflare) | per-run `.wrangler/e2e/<run-id>`; D1/R2 under `v3` |
| L3 | 27059 | per-run `.wrangler/e2e-pw/<run-id>` |

## Retrospective

Narratives live in [Retrospective.md](Retrospective.md); keep only recurring rules here.
