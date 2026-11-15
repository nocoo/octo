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
- Dashboard uses only `@nocoo/basalt@3.3.3` controls; MVVM with the single `fetch` in `src/client/lib/api.ts`.
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
bun run gate:coverage-script # test:coverage must invoke vitest --coverage
bun run gate:l1-probes       # L1 negative/healthy hook probes (CI prepare)
bun run gate:production   # Empty Access bypass in production build inputs
bun run gate:security    # gitleaks + osv-scanner; missing tools fail
```

## Testing and quality contract

Strict TDD; atomic Conventional Commits staging explicit paths; never `--no-verify`; do not push unless Zheng asks. External fetch paths need an L2 test that runs through the real runtime `fetch`, not only injected stubs.

Quality follows System1 v1.3.0 Native Mode (`nocoo/base-ci v2026.15`) in `.github/workflows/quality-slots.yml` and `.github/workflows/ci.yml`.

| Slot              | Status   | Evidence                                                                          |
| ----------------- | -------- | --------------------------------------------------------------------------------- |
| `S1` Types        | enforced | `bun run typecheck` (pre-commit + CI)                                             |
| `S2` Lint         | enforced | `bun run lint` (Biome, pre-commit + CI)                                           |
| `S3` Workflow     | enforced | SHA-pinned workflow action check in CI                                            |
| `G1` Secrets      | enforced | `gitleaks` (`.gitleaks.toml`) in pre-push + CI                                    |
| `G2` Dependencies | enforced | `osv-scanner` (`bun.lock`) in pre-push + CI                                       |
| `B1` Build        | enforced | `bun run build && wrangler deploy --dry-run` in CI                                |
| `L1` Unit         | enforced | `bun run scripts/pre-commit.ts` + `test:coverage` (≥95%) + `gate:l1-probes` in CI |
| `L2` Runtime      | N/A      | Miniflare/workerd integration covered by `L3` API E2E                             |
| `L3` Integration  | enforced | `bun run test:e2e:api` (direct Miniflare/workerd HTTP) in CI                      |
| `L4` E2E          | enforced | `bun run test:e2e:bdd` (Playwright Chromium) in CI                                |
| `P1` Package      | N/A      | Private repo, not published to npm                                                |
| `Z1` Gate         | enforced | `quality / Z1: Gate` required status check on `main`                              |

Details: [docs/07-dev-workflow.md](docs/07-dev-workflow.md).

## Release, CI and deploy

- Release: no release script. Version lives only in root `package.json` (`X.Y.Z`); tags and GitHub Releases use `vX.Y.Z`. Usually bump Z, Y for feature changes, X only with Zheng's approval. Manual cut per the workflow `nocoo-repo-steward` versioning reference: bump `package.json`, `bun install` to sync `bun.lock`, update root `CHANGELOG.md` (create it on the first release; no tags exist yet) from commits since the last tag, commit through hooks, push, then `git tag vX.Y.Z && git push origin vX.Y.Z` and `gh release create vX.Y.Z`. Release only when Zheng asks or another bot needs the change.
- CI (`.github/workflows/ci.yml`, push and PR to `main`, via `.github/workflows/quality-slots.yml`): gates `test-skip`, `no-remote`, `wrangler-vars`, `client-fetch`, `l1-probes`; typecheck; Biome lint; `test:coverage` (≥95%); build (`bun run build` incl. `gate:production`, plus `wrangler deploy --dry-run`); `L3` `test:e2e:api`; `L4` `test:e2e:bdd`. Merge only when green.
- Deploy: Cloudflare Worker `octo` at `https://octo.hexly.ai` (custom domain, D1 `octo-db`, R2 `octo-files`, Vectorize). Main-push CI success triggers `.github/workflows/release.yml` (`deploy-worker.yml@633a5545…`, environment `production`): proven source, remote D1 migrations, locked Wrangler deploy, `/api/live` version and `git_sha` verify. Manual retry via Release `workflow_dispatch` + successful CI run ID. Mac wrangler deploy remains an emergency fallback. Never print secrets.

## Resources and isolation

| Lane      | Ports (approved 2026-10-17, nmem `octo-local-ports`) | Boundary                                           |
| --------- | ---------------------------------------------------- | -------------------------------------------------- |
| Daily dev | Vite 7059, Worker 37059                              | Caddy `octo.dev.hexly.ai`; local D1/R2             |
| L2        | 17059 (direct Miniflare)                             | per-run `.wrangler/e2e/<run-id>`; D1/R2 under `v3` |
| L3        | 27059                                                | per-run `.wrangler/e2e-pw/<run-id>`                |

## Retrospective

Narratives live in [Retrospective.md](Retrospective.md); keep only recurring rules here.
