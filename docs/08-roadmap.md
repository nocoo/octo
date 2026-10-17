# 08 — 路线图

> 返回 [文档目录](README.md)

按分层构建：先做端到端可用的最小版本，再在已经能跑的产品上加能力。阶段 1 结束时交付给知识库 bot：base URL、admin key（由 Zheng 创建）、API 文档。

## 阶段总览

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| 0 脚手架 | 仓库骨架、门禁、端口和 Caddy、spike | L1 hook 能拦截失败；`/api/live` 本地通过 HTTPS 返回 200 |
| 1 API | 04 中所有 v1 端点 + admin key 管理的最小 API | L2 覆盖 100% 端点 × 方法；生产部署；知识库 bot 用 v1 API 跑通冒烟 |
| 2 MCP + Dashboard | `/mcp` 无状态 Streamable HTTP（工具映射到 v1 能力，用同一套 API key 和权限）；06 的全部页面 | MCP 契约测试且知识库 bot 能接入；L3 关键路径通过；Basalt 设计审计通过 |

**范围外：** 从 Nowledge Mem 迁移数据由知识库 bot 负责，用普通的 v1 API 完成；octo 不提供迁移专用的字段或接口（例如 `external_id`、时间戳覆盖）。

## 阶段 0 / 1 里程碑（为并行 agent 拆分）

先合入的串行前置（**M0 契约**），合入后扇出（M1–M7 可以并行，各自目录不冲突）。

### M0 — 骨架与契约（串行，主控或单个 agent）
1. Bun workspace、TS 7 三个 tsconfig、Biome、Vitest + 覆盖率阈值、Husky、`gate:test-skip` / `gate:no-remote` / `gate:wrangler-vars`、CI。
2. Hono 应用骨架、`/api/live`、错误信封、request id、`APP_VERSION`。
3. 本地 D1 / L2 runner（`_test_marker`、每次运行独立的目录和端口）。
4. 迁移 `0001_core.sql`（02 的全部表）+ zod schema（`src/lib/schema/*`）+ 错误码枚举。
5. **Spike：** 本地 D1 FTS5 trigram（中文二字词、bm25、contentless-delete）；记录结论。
6. 端口预留和 Caddy 映射（需要 Zheng 确认改 Caddyfile 和 workflow 副本）。

### 扇出（M0 合入后并行）

| 包 | 内容 | 主要目录 | 依赖 |
|---|---|---|---|
| M1 鉴权 | API key 解析、HMAC、`authorize()` 全组合矩阵、Access JWT 中间件（JWKS 缓存、iss / aud / exp）、同源检查 | `server/auth/` | M0 |
| M2 Memory CRUD + 版本 | 写路径 batch（02 §3）、乐观并发、版本、diff、回滚、回收站和恢复、change feed | `server/repo/memories*`、`routes/v1/memories*` | M0（鉴权用桩，M1 合入后替换） |
| M3 标签 / space | 规范化、重命名、合并重定向、计数可见性 | `server/repo/tags*`、`routes/v1/tags*` | M0 |
| M4 搜索 | FTS 查询构造（短词回退）、VectorStore 端口 + 两个实现 + 契约测试、过滤、RRF / weighted 融合 | `server/search/`、`server/ports/vector*` | M0、M2 的写路径接口 |
| M5 附件 | R2 BlobStore 端口、上传校验、流式下载、软删除 | `server/ports/blob*`、`routes/v1/attachments*` | M0 |
| M6 幂等 / 批量 / 分页 | Idempotency 中间件、游标编解码、batch 端点 | `server/http/` | M0 |
| M7 审计 / 用量 / admin | 审计中间件（waitUntil）、cron 汇总、`/api/admin/keys` 等、purge | `server/audit/`、`routes/admin/` | M1 |

**收尾（串行）：** `gate:api-inventory` 达到 100%、OpenAPI 生成、G2、release workflow、创建生产资源和首次部署（需要 Zheng 授权）、交付文档。

### 建议的 agent 分配

- review：固定组合 Codex `group/auto-gpt-6-astra` `high`。
- 实现：先用 workflow 的 `system1-quick-decide` 决定；参考做法是 M1 / M4 这类逻辑密集的包用较高档位，M3 / M5 / M6 这类模式明确的包用较低档位。
- 并行方式：MacBook 上的 herdr `octo` workspace（主控右侧开受控 pane）+ Cursor cloud agents（仓库 `https://github.com/nocoo/octo`）。每个包一个分支或 worktree，PR 合并到 main。Mac Studio 不参与。

## 阶段 2 预览

- Dashboard 拆成：壳与导航 → 记忆库与阅读 → 编辑 / diff / 回滚 → 搜索 → key / 用量 / 审计 → 可视化（图、时间线）→ 回收站与批量操作 → 动效打磨和 Basalt 审计。
- MCP 先于 Dashboard 交付，不用 Durable Objects：使用 MCP TypeScript SDK 的无状态 Streamable HTTP 传输（需在实现时核实 SDK 当前对无状态模式的支持），工具是 `search` / `get` / `create` / `update` / `list_changes` / `tags` 等，复用 v1 服务层和 `authorize()`。
