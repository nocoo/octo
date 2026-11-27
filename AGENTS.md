# Octo

Private, API-first memory / knowledge-base SaaS on Zheng's Cloudflare account, replacing Nowledge Mem.
Docs: [README.md](README.md) · [Design docs](docs/README.md) · [Dashboard](docs/06-dashboard.md) · [Dev workflow](docs/07-dev-workflow.md) · [MCP](docs/09-mcp.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Bun 1.4, Node >=26.12, TypeScript 7 strict, Hono, Vite 8, Biome 2.6, Vitest 5 + V8, Husky. Local env vars live in `dev.vars.example` (never commit `.dev.vars`).

```sh
bun install --frozen-lockfile
bun run dev                  # https://octo.dev.hexly.ai -> Vite 127.0.0.1:7059 + wrangler 37059
bun run seed:demo            # Local-only: 84 active memories + 6 trash (docs/local-demo-seed.md)
bun run typecheck            # S1 (root, client, scripts tsconfigs)
bun run lint                 # S2 biome check --error-on-warnings
bun run test:coverage        # L1 >=80% statements/branches/functions/lines
bun run test:e2e:api         # L3 direct Miniflare/workerd HTTP on 17059
bun run test:e2e:bdd         # L4 real Chromium Playwright on 27059
bun run build                # B1 gate:production + vite build (CI also wrangler deploy --dry-run)
bun run gate:test-skip       # No .only/.skip/.todo/xtest
bun run gate:no-remote       # Reject remote bindings in wrangler/tests
bun run gate:wrangler-vars   # Sync wrangler [vars] vs dev.vars.example; no secrets in vars
bun run gate:client-fetch    # Single fetch boundary in src/client/lib/api.ts
bun run gate:client-design   # Basalt containers/controls and token-only spacing
bun run gate:coverage-script # test:coverage invokes vitest --coverage
bun run gate:l1-probes       # L1 negative/healthy hook probes
bun run gate:production      # Empty Access bypass in production build inputs
bun run gate:security        # G1/G2 gitleaks + osv-scanner; missing tools fail
```

## Invariants

- Single Hono Worker serves `/api/v1/*` (API keys), `/api/admin/*` + SPA (Cloudflare Access), and `/mcp` (same API keys) at `https://octo.hexly.ai` (`workers_dev = false`); no Durable Objects or rate limiting.
- MCP uses official `@modelcontextprotocol/sdk` with a fresh Web Standard Streamable HTTP transport per request, JSON responses, and no sessions; contract and bot setup live in [docs/09-mcp.md](docs/09-mcp.md).
- Access verifies `Cf-Access-Jwt-Assertion` (`https://nocoo.cloudflareaccess.com` JWKS, `iss`, non-secret AUD in `apps/web/src/server/lib/access-config.ts`, test-only env overrides); `/api/v1/*` & `/mcp` bypass Access.
- D1 `octo-db` is the source of truth; Vectorize is a derived index rebuilt from vectors stored in D1; R2 `octo-files` holds attachments.
- API keys are stored as HMAC hashes only; plaintext appears once at mint/rotate and never in logs, URLs, D1, or browser storage. No key or permission management through `/api/v1`.
- Default deny; out-of-scope spaces are invisible (404, absent from lists/search/counts). Every call is audited without bodies or keys.
- Delete moves to trash and is never auto-purged; hard delete exists only in the dashboard.
- Every memory write is one D1 batch: row, version snapshot, tags, FTS, and change event ([docs/02-data-model.md](docs/02-data-model.md) §3).
- Tests never use remote Cloudflare resources or deploy `-test` resources; Vectorize is replaced locally by the D1 brute-force `VectorStore`.
- External fetch paths require an API E2E test (`test:e2e:api`) exercising the real runtime `fetch`, not only injected stubs.
- Embedding gateway settings (base URL, `OCTO_SETTINGS_KEY` AES-GCM key, model, dims, backfill toggle default off) are Access-only, never exposed on `/api/v1`; outbound embedding calls always send `User-Agent`.
- Dashboard uses only `@nocoo/basalt` controls (pinned in `apps/web/package.json`); MVVM with the single `fetch` in `apps/web/src/client/lib/api.ts`.
- Store timestamps in UTC; display only via `formatTimestamp` (`apps/web/src/client/lib/format.ts`, browser-local `YYYY-MM-DD，HH:mm`, no zone label or second formatter). Usage/dashboard ranges stay UTC calendar days.
- Dashboard layout: single-row `PageHeader` (no `description`/`filters`), 34px controls, internal-scroll tables, no toolbar `Field` or single-table `SectionRule` ([docs/06-dashboard.md](docs/06-dashboard.md) §8).
- Manual releases (`package.json` `X.Y.Z`, tags `vX.Y.Z`, `CHANGELOG.md`) require explicit authorization or bot need; follow [docs/07-dev-workflow.md](docs/07-dev-workflow.md) §5.
- `main` push (or `workflow_dispatch` with `deploy=true` on `main`) runs `.github/workflows/pipeline.yml` (`quality` -> `D1`–`D5` Worker deploy reusing `B1` `b1-dist-client`, `octo-db` D1 migrations, Wrangler deploy, `/api/live` SHA/version verify); Mac deploy emergency-only. Never print secrets.

## Quality & Local Gates

Follows `system1-quality` with strict TDD; CI slot definitions and pinned `base-ci` revision live in `.github/workflows/quality-slots.yml` via `.github/workflows/pipeline.yml` (`quality` -> `D1`–`D5` Worker deploy on `main` push; `quality / Z1: Gate` required on `main`). Raise weaker enforcement instead of lowering the contract. Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` is `N/A` (Miniflare/workerd integration covered by `L3` `test:e2e:api`). `L3` runs direct `node:sqlite` fixture access with `isolate: false` against local Miniflare; `L4` reuses the `B1` client artifact via `OCTO_SKIP_BUILD=1` and `setup-playwright`. `P1 Package` is `enforced` (`wrangler deploy --dry-run --outdir dist/worker` on `B1` artifact).
- **CI contract**: workflows pin `nocoo/base-ci` `v2026.24` (`3703a073693d598159e87f77f99587e586c14cfe`) and verify slots with checkout-free `z1-gate`.
- **Coverage scope**: `L1` >=80% on `apps/web/src/**` and `scripts/**`, excluding tests, `client/routes/**`, `client/components/**`, `client/main.tsx`, and `client/app.tsx` (`server/routes` stays included).
- **Local hooks**: installed via `prepare` (`.husky/`); `pre-commit` (`scripts/pre-commit.ts`) checks staged index (`S1/S2`, structural gates, `L1`). Never `--no-verify`.
- **Pre-push**: `.husky/pre-push` checks pushed ref ranges with `gate:no-remote`, then runs `L3` (`test:e2e:api`) and `G1/G2` (`gate:security`) in parallel.

## Resources & Isolation

| Lane | Endpoint / State | Boundary |
| --- | --- | --- |
| Daily dev | `https://octo.dev.hexly.ai` -> Vite `7059`, Worker `37059`; `.wrangler/state` | Caddy + mkcert; local D1/R2; preserve running server |
| API E2E (L3) | Direct Miniflare `127.0.0.1:17059`; JWKS stub `17057`; `.wrangler/e2e/<run-id>/v3` | Per-run isolated dir + `_test_marker` (`env=test`); never remote |
| Browser E2E (L4) | Playwright Chromium `127.0.0.1:27059`; `.wrangler/e2e-pw/<run-id>` | Isolated local fixtures only |
| Prod | `https://octo.hexly.ai` (Worker `octo`, D1 `octo-db`, R2 `octo-files`, Vectorize) | Read-only checks unless deployment is authorized |

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
