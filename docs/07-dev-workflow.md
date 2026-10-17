# 07 — 开发流程与质量门

> 返回 [文档目录](README.md)

质量契约沿用 workflow 的 6DQ（L1 / L2 / L3 / G2 / D1 隔离），门禁脚本参照 giraffe。功能代码开工前以本文为准。

## 1. 原则

- **严格 TDD：** 先在工作区写失败的测试，再写最小实现让它通过，再重构。红的测试不提交；禁止 `--no-verify`。
- **原子提交：** 每个逻辑变更一个 commit，用 Conventional Commits（`feat|fix|docs|test|refactor|chore: …`，全小写，≤50 字符），只 stage 具体文件（禁止 `git add -A` / `git add .`）。
- **不主动 push。** push 要等 Zheng 明确要求；push 前必须通过 pre-push（L2 ‖ G2）。
- 正确性只靠测试证明，不靠点页面或看部署是否返回 200。

## 2. 6DQ 总表

| 维度 | 命令 | 触发时机 | 时限 | 要求 |
|---|---|---|---|---|
| L1 | `bun run typecheck && bun run lint && bun run gate:* && bun run test:coverage` | pre-commit（index 快照） | <30s | Vitest + V8，statements / branches / functions / lines **四项都 ≥95%**；没有 skip / only；Biome `--error-on-warnings`；三个 tsconfig 都要 strict |
| L2 | `bun run test:e2e:api` | pre-push、CI | <3min（和 G2 并行） | Real local HTTP on direct Miniflare/workerd, local D1/R2 and vector store; **100% endpoint × method**, success, failure and authentication; Access uses the local JWKS stub |
| L3 | `bun run test:e2e:bdd` | CI / 手动 | — | 阶段 2 起：Playwright Chromium 跑关键用户路径 |
| G2 | `bun run gate:security` | pre-push、CI | 同上 | gitleaks（按 pre-push stdin 给出的提交范围）+ osv-scanner（`bun.lock`）；缺少工具也算失败 |
| D1 隔离 | runner 内置 | L2 / L3 | — | 每次运行用独立的 `persist-to` 目录和端口；必须断言是本地模式，拒绝 `--remote` / `remote: true`；用 `_test_marker(key,value)` 的 `env=test` 证明归属后才能 seed / reset / 清理；**不建任何远程 `-test` 资源** |

结构性 gate（照搬 giraffe 并按 octo 调整）：`gate:test-skip`（扫描 `.only/.skip/.todo/xtest…`）、`gate:wrangler-vars`（确认 `[vars]` 和 `.dev.vars.example` 一致，并且 secret 不出现在 vars 里）、`gate:client-fetch`（阶段 2 起）、`gate:no-remote`（检查 wrangler 配置和测试脚本里没有 `remote`）、`gate:api-inventory`（用 AST 提取路由清单，与 L2 断言清单对比，必须 100% 一致）。

覆盖率范围：`apps/web/src/**/*.{ts,tsx}` 加上 `scripts/**`。只排除测试文件、`client/routes/**/*.tsx`、`client/components/layout/**/*.tsx`、`client/main.tsx`、`client/app.tsx`。`server/routes` **不豁免**。

`gate:client-design` runs in L1 and rejects handwritten structural containers, native controls (except hidden file uploads), and non-Basalt margin/padding/gap values in client JSX/CSS; semantic forms, prose, canvas geometry and package internals remain distinct from application layout.

## 3. 本地开发和 Caddy

`ensureDevVars` copies `ACCESS_DEV_BYPASS_EMAIL=dev@local` and `RESOURCE_ENV=development` from `dev.vars.example` only when local vars are missing, preserves existing files, and local config generation removes routes without changing production `wrangler.toml`; never commit `.dev.vars`.

| 通道 | 地址 / 端口 | 持久化 |
|---|---|---|
| 日常开发 | `https://octo.dev.hexly.ai` → Vite `127.0.0.1:7059`（HMR），`/api` 和 `/mcp` 反代到 wrangler sidecar `127.0.0.1:37059` | `.wrangler/state` |
| L2 | Direct Miniflare Worker `17059`; local JWKS stub `17057` | `.wrangler/e2e/<run-id>/v3` |
| L3 | Worker `27059` | `.wrangler/e2e-pw/<run-id>` |

The L3-only Origin exception requires `RESOURCE_ENV=test`, request URL origin and browser Origin both exactly `http://127.0.0.1:27059`; production and development retain their fixed HTTPS origins and Access verification is never bypassed by this exception.

Attachment L2 requests use `undici.request` through `scripts/e2e-fetch.ts`.
The HTTP client preserves a delivered early error response while the server
terminates an unfinished upload; Node Fetch can instead reject that response
with the upload's `EPIPE`. Original byte bodies, multipart forms, chunked streams
and assertions remain intact. No retry or error-code suppression is used;
failures before a response and response-stream failures still fail the test.
Production requests and the vector authorization regression do not use this
test-only adapter.

- **端口 7059 系列已获 Zheng 批准（2026-10-17）**，nmem 记录 `octo-local-ports`。`octo.dev.hexly.ai` 的映射写在本机 `/opt/homebrew/etc/Caddyfile`（照 `system0-dev-machine-caddy` 的模板：HTTP → HTTPS 跳转 + mkcert 证书 + `reverse_proxy localhost:7059`）；`workflow/caddy/Caddyfile` 副本由 workflow 维护 bot 同步，本仓库不改 workflow。
- `*.dev.hexly.ai` 通配证书已经覆盖了这个域名，不需要动证书。
- 日常开发、截图、验收都用 HTTPS 域名；loopback 只作为内部上游和自动化测试的端点。
- `bun run dev` 同时启动 Vite 和 wrangler sidecar，跑在 herdr 同一个 space 里名为 `dev server` 的 tab 中（机器规则：不在后台跑）。
- Dev server 的 `allowedHosts` 只放行 `octo.dev.hexly.ai`；admin 写请求的 origin 检查在开发环境接受这个域名。

## 4. Hooks

| Hook | 内容 |
|---|---|
| pre-commit | L1（对 index 快照：用 `git stash --keep-index` 或者导出到临时 worktree 后再检查），目标 <30s |
| pre-push | Read pushed ref ranges from stdin, require `gate:no-remote`, then run direct-Miniflare L2 and G2 in parallel; either failure blocks the push, including new branches |

`bun install` 时通过 `prepare: husky` 恢复 hooks。

## 5. CI / CD

- `.github/workflows/ci.yml`：调用 `nocoo/base-ci/.github/workflows/quality.yml`，固定到与 giraffe 相同的 SHA（`ad43150…`），`l2: true`；阶段 2 起 `l3: true`。
- `.github/workflows/release.yml`：只在 main CI 通过后、明确的版本 tag 或手动 dispatch 时运行：先跑 D1 迁移（只做加法）→ Vectorize metadata index 校验 → `vite build` → `wrangler deploy`。不从笔记本并发部署。
- 部署后验证 `GET https://octo.hexly.ai/api/live`，确认版本号和 D1 `SELECT 1`。
- 首次部署前的一次性资源准备（需要 Zheng 授权）：`wrangler d1 create octo-db`、`wrangler r2 bucket create octo-files`、`wrangler vectorize create octo-vec-<profile> --dimensions=<d> --metric=cosine`，以及 7 个 `create-metadata-index`，最后用 `wrangler secret put API_KEY_PEPPER` 写入 secret。

## 6. 多 agent 并行开发

- 主控在 herdr 的 `octo` workspace 里调度，受控 agent 在主控 pane 右侧开；按 workflow 的「启动参数」和「调度规范」选择 agent 和 reasoning level；review 用固定组合（Codex `group/auto-gpt-6-astra` `high`）。
- 并行用 MacBook herdr 和 Cursor cloud agents，各自领 08 里互不冲突的工作包；共享契约（02 schema、04 schema、05 判定）先合入，之后再扇出。
- 项目的长期规则写在根目录 `AGENTS.md`；事故复盘写在 `Retrospective.md`。

## 7. Attachment early-response proof

L2 bundles `tests/fixtures/worker.ts` with Bun and starts the pinned Miniflare API directly. `unsafeDirectSockets` binds the actual Worker service to `127.0.0.1:17059`, bypassing both Wrangler's development ProxyWorker and Miniflare's entry Worker. Miniflare's unused control listener receives an ephemeral loopback port. Static assets live in a separate local assets-only Worker bound as `ASSETS`: the application still calls `env.ASSETS.fetch`, but API ingress never traverses Miniflare's assets router/RPC proxy. No draining flag, request retry, sleep or client abort is needed for oversize assertions. Daily development remains Vite plus the Wrangler sidecar; its ports and Caddy configuration are unchanged.

Each run exclusively creates `.wrangler/e2e/<run-id>`. Local-only Wrangler D1 commands create and verify `_test_marker env=test` before applying migrations; the direct runtime and fixture SQL session share that run's `v3` storage. Fixture SQL still uses `getPlatformProxy` with `remoteBindings: false` and `envFiles: []`, not an HTTP proxy. It verifies matching canonical run paths, rejects symlinks/hardlinks and checks the marker before every mutation. Only the configured local D1/R2, static assets and explicit test bindings enter the runtime; Vectorize and routes are removed, remote bindings are rejected, and Miniflare telemetry, CF lookup and dev-registry registration are disabled. The fixture Worker checks the marker before seeding. Runtime disposal and JWKS shutdown run after success or failure.

The application stops at the byte limit and releases its reader without cancelling the incoming transport before the error response. In the pinned workerd `1.20260930.2`, the native incoming-stream owner terminates the stream after the response proxy task completes, or on disconnect. See [the pinned runtime source](https://github.com/cloudflare/workerd/blob/v1.20260930.2/src/workerd/api/global-scope.c%2B%2B).

`tests/api/attachments-early-abort.test.ts` sends exactly the applicable limit plus one byte over raw HTTP, then holds the remaining tail and EOF behind an event latch. Declared oversize and unauthenticated probes send no body bytes. The complete error envelope must arrive with the latch still held. The test-only Worker counts application reads and starts one pending native observation read after the application returns; it must receive zero bytes and fail with the runtime's exact `SENT_RESPONSE` message. Two subsequent observations must show unchanged application counts before the client releases the tail for orderly transport cleanup. There is no test-side cancellation, timed sleep, or Worker shutdown in this proof. The observer is not production cancellation logic, and native stream termination is not claimed to be peer TCP closure.

All finite oversize assertions removed by `d849105` and `c891bf3` are restored verbatim: raw and multipart 50 MiB + 1 byte, keyed and unkeyed chunked bodies, keyed declared size, multipart envelope and oversized extra fields. Exactly-50-MiB acceptance and all seven native-owner proofs remain unchanged. The local-proxy acceptance exception is retired for L2; this is evidence for the direct local runtime, not a claim that Wrangler's proxy or production transport was fixed.
