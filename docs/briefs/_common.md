# Common rules for every octo milestone brief

Repo: nocoo/octo (https://github.com/nocoo/octo). Base: latest origin/main (M0 merged). Work in your own branch `m<N>-<slug>` (local herdr: a dedicated git worktree at /Users/nocoo/workspace/personal/octo-wt/<branch>; cloud agent: its own branch + PR to main).

Read first: AGENTS.md, docs/README.md, the docs named in your brief, docs/07-dev-workflow.md, and the existing code under apps/web/src (M0 skeleton: error envelope, request id, zod helpers, migration 0001, L2 runner). Schema is already in migrations/0001_core.sql — add NEW migrations (000N_*.sql) only if strictly needed, additive only, and say so in the PR.

Rules:
- Strict TDD: failing test first, minimal implementation, refactor. Each commit = one logical change WITH its tests, passing pre-commit (typecheck, lint, gates, test:coverage with statements/branches/functions/lines ≥95%). Conventional Commits, lowercase, ≤50 chars. Stage explicit paths only. Never --no-verify.
- L2: every endpoint×method you add must be covered by real-HTTP tests in tests/api/ and registered in the route inventory (the inventory gate must stay 100%).
- Stay inside your directories (listed in your brief). If you must touch a shared file (apps/web/src/server/index.ts route mounting, lib/schema/index.ts exports, inventory list), keep the change minimal and append-only to ease merges.
- No remote Cloudflare resources, no wrangler deploy / --remote / d1 create. Vectorize has no local simulation: use the VectorStore port (D1 brute-force implementation locally).
- npm registry is blocked on Zheng's Mac: install with a temporary mirror (`BUN_CONFIG_REGISTRY=https://packagefeedproxy.microsoft.io/npm/ bun install`), never commit mirror URLs into bun.lock (`rg -c '", "https' bun.lock` must be 0). Cloud agents can use the default registry.
- No Durable Objects, no rate limiting.
- Don't push to main. Local herdr workers: don't push at all (controller pushes after review). Cloud agents: push your branch and open a PR.

Final report: commit list, gate outputs (typecheck, lint, each gate, four coverage numbers, test:e2e:api count), any additive migrations, open issues.

L2 port note: the L2 runner binds the fixed reserved port 17059 and fails (no fallback) when busy. Parallel local workers must not run test:e2e:api at the same time; if it fails with port-in-use, wait and retry. Cloud agents run in their own machines and are unaffected.
