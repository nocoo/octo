# 01 — 架构与技术栈

> 返回 [文档目录](README.md)

## 1. 需求摘要（v1）

| 领域 | 要点 |
|---|---|
| 数据 | memory = Markdown 正文 + `id,title,tags,type,importance,source(key),space,created/updated,event_time?,attachments`；完整版本历史，支持 diff 和回滚；附件（图片 / PDF）；每个 agent 一个 space；全局标签（列表 / 重命名 / 合并） |
| 搜索 | 中英文全文；调用方自带向量（记录 model + dims，以便重建）；过滤（tags/space/type/source/time/importance）；混合融合，返回每个通道的分数；批量 get；按游标增量拉取（含删除事件） |
| API | CRUD、批量、幂等键、搜索、版本 / 回滚、标签、space、附件、回收站；只用 API key 认证；API 不提供 key / 权限管理；用量统计、清晰的错误 |
| 权限 | key 即 agent 身份；read/write/update/delete 可组合；范围：全部 / 指定 space / 仅自己的 space；可选「只能改 / 删自己的条目」；默认拒绝，无权访问的 space 不可见；每次调用都写审计；key 可过期 / 轮换 / 吊销，明文只显示一次；删除进回收站，永不自动清除；硬删除只能在 dashboard 做 |
| Dashboard | Cloudflare Access 保护、全部权限：key 管理、Markdown 阅读、编辑、diff、回滚、标签 / space / 回收站、批量操作、可视化、审计查询 |

**Zheng 已调整的范围：** 不做速率限制（需求里的 rate limits 删掉）；不用 Durable Objects；R2 以后挂到 Zheng 配置的 CDN 域名下；MCP 放到阶段 2。从 Nowledge Mem 迁移数据由知识库 bot 负责，不在 octo 范围内。

## 2. 拓扑

```
知识库 bot / 其他 agent ──Bearer octo_…──▶ octo.hexly.ai/api/v1/*  ─┐
Zheng 浏览器 ──Cloudflare Access──▶ octo.hexly.ai/ (SPA) + /api/admin/* ─┤
                                                                      ▼
                                        单个 Worker（Hono），无 Durable Objects
                                        ├─ D1  octo-db   （权威数据：memory/版本/变更/key/审计/向量原值）
                                        ├─ R2  octo-files（附件，以后经 CDN 域名分发）
                                        ├─ Vectorize octo-vec-<profile>（派生索引，可从 D1 重建）
                                        └─ ASSETS dist/client（Vite SPA）
```

- 只有一个 Worker、一个部署单元，和 giraffe 一样：`[assets]` 托管 SPA，`run_worker_first = ["/api", "/api/*", "/mcp"]`。
- `workers_dev = false`、`preview_urls = false`，只走 custom domain `octo.hexly.ai`。
- Cron trigger 只做幂等记录清理和用量汇总，**不碰**回收站。
- D1 是唯一的权威数据源。Vectorize 是派生索引，丢了可以用 D1 里存的向量原值重建。

## 3. 技术栈

以 nocoo/giraffe（v0.15.0，`ac2d1e3`）为基线，只改需求要求的部分。

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 / 包管理 | Bun 1.4（`bun install --frozen-lockfile`，`bun.lock`） | 与 giraffe 一致；本机 npm registry 被 IT 拦截，安装按 workflow `rules/tool-npm.md` |
| 语言 | TypeScript 7 `strict` + `exactOptionalPropertyTypes` | giraffe 同款；Worker / Client / scripts 分三个 tsconfig |
| Worker | Hono 4 + zod 4 校验 | giraffe 同款，路由和中间件分层清晰 |
| 数据 | D1（`octo-db`，binding `DB`），SQL 迁移在 `migrations/NNNN_*.sql` | 原生 FTS5；可用 Time Travel 恢复 |
| 文件 | R2（`octo-files`，binding `FILES`） | 附件；CDN 域名后接 |
| 向量 | Vectorize V2（binding `VEC`） | 调用方自带向量；cosine；metadata 过滤 |
| 前端 | Vite（实现时用最新 8.x）+ React 19 + React Router + Tailwind CSS v4 + `@nocoo/basalt@3.1.0` + recharts | 照搬 giraffe 的 SPA 框架；Basalt 版本锁到 3.1.0 |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight`（或 shiki）+ 前端 sanitize | 表格、代码高亮、TOC |
| Diff | `diff`（jsdiff），服务端算 | 版本对比 |
| Lint / 格式化 | Biome 2.5（`--error-on-warnings`，配置以 giraffe `biome.json` 为起点） | 用户要求 + giraffe 同款 |
| 测试 | Vitest 5 + `@vitest/coverage-v8`（四项都 ≥95%）、real-HTTP L2 runner、Playwright Chromium L3 | 6DQ |
| Hooks / CI | Husky 9；`nocoo/base-ci` 共享 workflow（固定到与 giraffe 相同的 SHA） | 6DQ L1 / L2 / G2 |
| 安全扫描 | gitleaks + osv-scanner（`gate:security`） | G2 |

**明确不用：** Durable Objects、`@cloudflare/vite-plugin`（giraffe 也不用，开发用 Vite + wrangler sidecar）、Next.js、速率限制、KV（暂时不需要）、Workers AI（向量由调用方提供；dashboard 查询向量的来源待定，见 99）。

## 4. 目录（目标）

参照 giraffe：

```
apps/web/
  index.html
  src/server/        # Hono 路由、中间件、服务、仓储（D1/R2/Vectorize 端口）
    routes/v1/*.ts   # 机器 API
    routes/admin/*.ts# dashboard API（Access）
    auth/            # api-key、access-jwt、权限判定
    search/          # fts、vector、fusion
    repo/            # D1 访问，纯 SQL + 映射
    ports/           # VectorStore / BlobStore 接口与实现
  src/client/        # SPA：routes（薄壳）、viewmodels、components、lib/api.ts
  src/lib/           # 共享类型、zod schema、错误码、version
migrations/
scripts/             # dev、run-e2e、run-e2e-bdd、gate-*.ts、local-d1
tests/{api,e2e,fixtures}/
docs/
```

阶段 1 只建 `src/server`、`src/lib`、`tests/api` 和必要的 scripts；`src/client` 从阶段 2 开始。

## 5. Wrangler 绑定（草案）

```toml
name = "octo"
main = "apps/web/src/server/index.ts"
compatibility_date = "<实现当日>"
workers_dev = false
preview_urls = false

[observability]
enabled = true

[assets]
directory = "./dist/client"
binding = "ASSETS"
run_worker_first = ["/api", "/api/*", "/mcp"]
not_found_handling = "single-page-application"

[[routes]]
pattern = "octo.hexly.ai"
custom_domain = true

[[d1_databases]]
binding = "DB"
database_name = "octo-db"
database_id = "<创建后填写>"

[[r2_buckets]]
binding = "FILES"
bucket_name = "octo-files"

[[vectorize]]
binding = "VEC"
index_name = "<见 03 §3，按 embedding profile 命名>"

[triggers]
crons = ["17 * * * *"]
```

Secrets（`wrangler secret`，本地用 `.dev.vars`，由 `dev.vars.example` 初始化）：`API_KEY_PEPPER`（API key HMAC 的 pepper）。Access team domain 和 AUD 不是 secret：和 giraffe 一样，写成代码常量 `apps/web/src/server/lib/access-config.ts`，只有测试环境可以通过 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` / `ACCESS_JWKS_URL` 覆盖（见 05 §2）。

## 6. 横切约定

- **ID：** ULID（26 字符，按时间排序，满足 Vectorize id ≤64 字节）。前缀只出现在 API key 上（`octo_`）。
- **时间：** 存 UTC 毫秒整数；API 输入输出用 ISO 8601（带 `Z`）。
- **请求 ID：** 每个请求生成 `request_id`，写进响应头 `X-Request-Id`、错误信封和审计。
- **健康检查：** `GET /api/live` 返回 `version` 和 D1 `SELECT 1` 结果；失败时 503，不缓存（与 giraffe 相同）。
- **版本号：** 根 `package.json` 是唯一来源，通过 `src/lib/version.ts` 读成 `APP_VERSION`。
