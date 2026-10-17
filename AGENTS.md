# Octo

Private, API-first memory / knowledge-base SaaS on Zheng's Cloudflare account, replacing Nowledge Mem. Design-phase repository: no application code yet.

Direction: [design docs index](docs/README.md) (Chinese). Frameworks must not rewrite this file.

## Scope and instruction sources

- This file is the only project handbook. Do not create a `CLAUDE.md` alias or copy.
- Contract lives here and in `docs/`; hooks, CI and configuration must enforce it once code exists. Raise weaker enforcement instead of lowering the contract.
- Machine rules: global `AGENTS.md` and `rules/` in the workflow repo. Accident narratives: [Retrospective.md](Retrospective.md).

## Project invariants

- Single Hono Worker serving `/api/v1/*` (API-key auth), `/api/admin/*` + SPA (Cloudflare Access) and, in phase 2, `/mcp`. No Durable Objects. No rate limiting.
- Production `https://octo.hexly.ai` (`workers_dev = false`); local `https://octo.dev.hexly.ai` via Caddy.
- Access: verify `Cf-Access-Jwt-Assertion` against `https://nocoo.cloudflareaccess.com` JWKS, `iss` and AUD `9ab761cf…88d67` (code constants in `server/lib/access-config.ts` as in giraffe; not secrets; env overrides only in tests). `/api/v1/*` and `/mcp` bypass Access and use Worker-verified API keys.
- D1 `octo-db` is the source of truth; Vectorize is a derived index rebuilt from vectors stored in D1; R2 `octo-files` holds attachments.
- API keys are stored as HMAC hashes only; plaintext appears once at mint/rotate and never in logs, URLs, D1 or browser storage. No key or permission management through `/api/v1`.
- Default deny; out-of-scope spaces are invisible (404, absent from lists/search/counts). Every call is audited without bodies or keys.
- Delete moves to trash and is never auto-purged; hard delete exists only in the dashboard.
- Every memory write is one D1 batch: row, version snapshot, tags, FTS, change event (see docs/02 §3).
- Tests never use remote Cloudflare resources or deploy `-test` resources; Vectorize is replaced locally by the D1 brute-force `VectorStore`.
- Dashboard uses only `@nocoo/basalt@3.1.0` controls; MVVM with the single `fetch` in `src/client/lib/api.ts`.

## Setup and commands

Planned toolchain (mirrors nocoo/giraffe): Bun 1.4, TypeScript 7 strict, Hono, Vite (latest), React 19, Tailwind v4, Biome, Vitest + V8 coverage, Playwright, Husky. Commands will be listed here when `package.json` lands; until then there is nothing to build or test.

## Testing and quality contract

Strict TDD; atomic Conventional Commits staging explicit paths; never `--no-verify`; do not push unless Zheng asks.

| Dimension | Required proof | Status |
|---|---|---|
| L1 pre-commit | Statements/branches/functions/lines each ≥95%, no skipped/focused tests, strict typecheck, Biome `--error-on-warnings`, on the index snapshot <30s | planned |
| L2 API | Real local HTTP over 100% endpoint × method, success/failure/auth | planned |
| L3 UI | Critical dashboard journeys in Chromium (phase 2) | planned |
| G2 security | gitleaks over pushed ranges + osv-scanner on `bun.lock` | planned |
| D1 isolation | Per-run local persistence and ports, local-mode assertion, `_test_marker env=test` before fixtures/cleanup | planned |

Details: [docs/07-dev-workflow.md](docs/07-dev-workflow.md).

## Resources and isolation

| Lane | Ports (proposed, pending reservation) | Boundary |
|---|---|---|
| Daily dev | Vite 7059, Worker 37059 | Caddy `octo.dev.hexly.ai`; local D1/R2 |
| L2 | 17059 | per-run `.wrangler/e2e/<run-id>` |
| L3 | 27059 | per-run `.wrangler/e2e-pw/<run-id>` |

## Retrospective

Narratives live in [Retrospective.md](Retrospective.md); keep only recurring rules here.
