# 09 — MCP 服务与知识库 bot 接入

> 返回 [文档目录](README.md)。权限以 [05](05-auth-permissions-audit.md) 为准，数据语义复用 [04](04-api.md)。

## 1. 端点与无状态传输

`https://octo.hexly.ai/mcp`（本地 `https://octo.dev.hexly.ai/mcp`）由同一个 Hono Worker 提供，使用官方 `@modelcontextprotocol/sdk` **1.32.1**，不是 REST 转发代理。

2026-10-18 从允许的 npm registry 获取并核实该版本源码：

- `dist/esm/server/webStandardStreamableHttp.d.ts` 明确支持 Cloudflare Workers、原生 `Request` / `Response`，并注明 `sessionIdGenerator: undefined` 关闭 session 管理。
- 同名 `.js` 的 `handleRequest()` 拒绝复用无状态 transport；每次 HTTP 请求必须新建 `Server` 和 `WebStandardStreamableHTTPServerTransport`，处理完毕后关闭。
- 设置 `enableJsonResponse: true`；省略 `sessionIdGenerator`（即运行时 undefined，符合 SDK 的 exact-optional 类型声明）和 `eventStore`，不保存 session、消息历史或初始化状态，不使用 Durable Objects。所有响应均不生成 `Mcp-Session-Id`。
- SDK `types.js` 的最新协议是 `2025-11-25`；协议协商和版本头校验交给 SDK。初始化之后的请求携带协商的 `MCP-Protocol-Version`，不依赖落到同一个实例。

上游版本证据：[SDK v1.32.1](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.32.1/src/server)。安装固定版本并记录到 lockfile；不提交镜像 URL。

| 方法 | 行为 |
|---|---|
| `POST /mcp` | 每次一个 JSON-RPC 2.0 请求或通知；请求返回 JSON，通知返回空 `202` |
| `GET /mcp` | 鉴权后 `405`，不建立 SSE 订阅 |
| `DELETE /mcp` | 鉴权后 `405`，没有可删除的 session |
| 其他方法 | 鉴权后 `405`，`Allow: POST` |

POST 必须带 `Content-Type: application/json`、`Accept: application/json, text/event-stream`。虽然成功响应选 JSON，客户端仍须声明两种 Streamable HTTP 媒体类型。拒绝 JSON-RPC batch（包括空数组），从而一个请求最多调用一个工具。复用 v1 的有限 JSON 读取器（请求上限 6,100,000 UTF-8 字节）；memory 的 `body` 上限仍为 1,000,000 UTF-8 字节。

只声明 tools capability，不支持 task-augmented execution、服务端主动通知或恢复游标；请求 task 扩展返回 `-32602`，不创建后台 MCP 任务。

## 2. 认证、权限与审计

- 每个请求（包括 initialize、通知、GET 和 DELETE）使用 v1 的 Bearer middleware。没有 key、key 错误、过期或吊销均为 HTTP `401`，使用原有 Octo 错误信封。Access cookie / JWT 不能代替 API key。
- `/mcp` 的 Cloudflare Access bypass 与 `/api/v1/*` 相同；部署配置由单独授权的运维操作维护，本里程碑不修改线上 Access。
- 非浏览器 bot 不需要 `Origin`；如有 `Origin`，必须精确匹配生产域名，开发环境匹配开发域名。不反射 Origin，不启用跨域 CORS。
- 每次工具调用从本次已验证的 principal 构造 v1 authz，使用原有服务及 `authorize()`。不可见 space / memory 是 `not_found`；列表、搜索、计数、batchGet 和变更流不暴露不可见对象。`own_entries_only` 和移动的源/目标权限保持不变。
- 不增加 key 管理、embedding 设置、硬删除、附件或恢复工具。`delete_memory` 只移入回收站。
- 标签名称是 v1 的全局字典；`list_tags` 与同 key 的 REST 列表完全一致，不可见 space 的引用不计入 use_count（可以为 0），不把全局标签误当成按 space 私有的资源。
- 写工具复用 v1 的 staged `memoryService()`，并在返回成功前执行一次 D1 batch（memory、版本、tags、FTS、change event 等同批提交）。失败不提交残留 statements；成功后按 v1 的机制调度派生索引任务。
- 外层 audit middleware 对每个 HTTP 调用记录一次 `route=/mcp`、actor、HTTP status、request id、耗时和字节数。不记录工具 arguments、响应正文、key、原始 URL 或任意客户端提供的工具名。HTTP `200` 的工具失败仍记录 Octo `error_code`，不能误报为成功。
- 审计用扩展表 `mcp_audit_writes(audit_id)` 标识已提交的 MCP 写操作（仅 memory D1 batch 成功后，在审计 batch 中同时写入 audit_log 和标记）。usage 汇总同时检查 error_code，MCP initialize、通知、读工具和失败写入均不计为 writes；REST 的现有方法分类保持不变。新增 migration `0005_mcp_audit.sql` 只创建幂等的审计扩展表，不存 session 或工具参数；本功能尚未部署，无历史 MCP 记录需要回填。

## 3. 工具输入 schema

`tools/list` 返回以下九个固定名称及可机器读取的 JSON Schema；不按 key 隐藏工具名称，权限在调用时判定。对象输入是 strict object，拒绝未定义字段。`?` 表示可选；没有参数的工具传 `{}`，也允许省略 arguments。

| 工具 | 输入 | 既有实现 / 权限 |
|---|---|---|
| `search` | 原 `searchRequestSchema`：`query?: string`、`vector?: Vector`（至少一个），`filters?: Filters`、`mode?: hybrid\|fts\|vector`、`fusion?: Fusion`、`limit?: integer[1,200]`、`include?: [snippet]` | `searchMemories` + `requireSearchRead`；`r` |
| `get_memory` | `{id: nonempty string, include?: (trashed\|versions_count\|attachments\|vector_status)[]}` | `MemoryService.get`；`r`，含 trashed 还需 `d` |
| `batch_get` | 原 `batchGetRequestSchema`：`{ids: nonempty string[1..100]}` | `batchGetMemories` + `requireSearchRead`；`r`，不可见 ID 与不存在 ID 一同放入 missing |
| `create_memory` | 原 `memoryCreateSchema`：`{space, title, body, type, tags, importance?, event_time?, vector?}` | staged `MemoryService.create`；目标 space 的 `w` |
| `update_memory` | `{id: nonempty string, patch: memoryPatchSchema}`；patch 至少改一个字段，`expected_version` 必须提供 | staged `MemoryService.patch`；`u`，移动同时检查两端 |
| `delete_memory` | `{id: nonempty string}` | staged `MemoryService.remove`；`d` |
| `list_changes` | `{cursor?: nonempty string, limit?: integer[1,200], spaces?: nonempty string[]}`；默认 limit 50，cursor 是原 v1 不透明游标 | `MemoryService.listChanges`；`r` |
| `list_tags` | `{}` | v1 标签列表服务；`r`，计数只统计可见 space |
| `list_spaces` | `{}` | v1 space 列表服务；`r`，仅返回可见 space |

`Vector`、`Filters`、`Fusion` 直接复用 `apps/web/src/lib/schema/{memory,filters,search}.ts`，不另设 MCP 方言。`space` 最长 64，`title` 1–500，tags 最多 100 个且各 1–64，importance 在 0–1；type 为 fact / preference / decision / procedure / event / log / note；event_time 是 UTC ISO 日期。更新允许清空 event_time / vector。向量维数由原有 profile 校验，最多 1536。

## 4. 工具输出 schema

成功的 MCP `CallToolResult` 同时包含 `structuredContent: Result` 和 `content: [{type: "text", text: JSON.stringify(Result)}]`。`tools/list.outputSchema` 是 object，`anyOf` 明确描述成功 Result 或下节 error 对象；官方 SDK 1.32.1 客户端即使收到 `isError=true`，仍会校验存在的 structuredContent，因此失败分支也必须在 schema 中。数据字段与 v1 相同，不添加 REST 外层信封或 MCP 专属数据副本。

| 工具 | Result 对象 schema |
|---|---|
| `search` | `{items: SearchMemory[], channels: {fts: {candidates: integer, partial: boolean}, vector: {candidates: integer, truncated: boolean, profile: string\|null}}}` |
| `get_memory` / `create_memory` / `update_memory` | `Memory` |
| `batch_get` | `{items: MemorySummary[], missing: string[]}` |
| `delete_memory` | `{trashed_at: string}`（UTC ISO） |
| `list_changes` | `{items: Change[], next_cursor: string\|null}` |
| `list_tags` | `{items: Tag[], next_cursor: null}` |
| `list_spaces` | `{items: Space[], next_cursor: null}` |

- `Memory`：id、space、title、body、type、tags（string[]）、importance（number）、event_time（string|null）、version（integer）、content_hash、source_key_id、updated_by_key_id、created_at、updated_at。可选扩展为 versions_count、attachments、vector_status、deleted_at、deleted_by，按 v1 include 和序列化器决定。
- `MemorySummary` 是 v1 搜索/batchGet 的既有投影：id、space、title、body、type、tags、importance、event_time、created_at、updated_at，不包含 CRUD 的版本与来源字段。`SearchMemory` 是 MemorySummary 加 scores 对象、可选 snippet；channels 和 scores 沿用 [03](03-search.md)。
- `Change`：seq、entity、entity_id、op、at；非删除事件另有 space_id、version、actor。删除事件不返回这些扩展。
- `Tag`：id、name、display_name、use_count，与 v1 标签列表的投影一致；列表不返回时间戳或 merged_into。
- `Space`：id、slug、name、description、owner_key_id（string|null）、memory_count、created_at、updated_at。

## 5. 错误映射

| 层级 | HTTP / MCP 结果 |
|---|---|
| Bearer 失败 / 非法 Origin | HTTP 401 / 403，原 Octo error 信封；尚未进入 JSON-RPC |
| 不支持的方法 / Accept / Content-Type | HTTP 405 / 406 / 415，JSON-RPC error；无工具执行 |
| JSON 语法错误 | HTTP 400，JSON-RPC `-32700` |
| 非法 JSON-RPC 信封 / batch | HTTP 400，JSON-RPC `-32600` |
| 请求体过大 | HTTP 413，JSON-RPC `-32600`，审计 `payload_too_large` |
| 未知 RPC 方法 | HTTP 200，JSON-RPC `-32601` |
| 未知工具 / 非法 tools/call RPC 参数 | HTTP 200，JSON-RPC `-32602` |
| 工具参数或业务失败 | HTTP 200，`result.isError=true`；content 和 structuredContent 含 `{error:{code,message,request_id,details?}}` |

工具的 `validation_failed`、`not_found`、`forbidden`、`version_conflict`、`vector_dimension_mismatch` 等沿用 v1 code；未知异常统一 `internal` / `internal error`，提交故障按 v1 compensation mapper 转换或返回 `unavailable`。不泄漏 SQL、堆栈、配置或秘密。bot 必须同时检查 HTTP、JSON-RPC error 和 `isError`，不能仅凭 HTTP 200 判断成功。

不实现 MCP 写入幂等键或会话重放。更新用 `expected_version` 防止覆盖；创建响应丢失时，bot 必须先核对数据，不应自动重试可能已提交的 create。需要 REST 幂等键的任务继续走 v1。

## 6. 知识库 bot 配置与验收

以下为支持远端 Streamable HTTP 的 MCP 客户端配置模板；`${OCTO_API_KEY}` 必须由 bot 的秘密管理器在启动时注入，不应把真实值存到仓库、URL、浏览器存储或日志。不同客户端的环境变量替换语法按其实现调整。

```json
{
  "mcpServers": {
    "octo": {
      "type": "http",
      "url": "https://octo.hexly.ai/mcp",
      "headers": { "Authorization": "Bearer ${OCTO_API_KEY}" }
    }
  }
}
```

bot 先 initialize（协议 `2025-11-25`、clientInfo、capabilities），发送 `notifications/initialized`，然后 tools/list 和 tools/call；后续 HTTP 请求照常带 key 和协议版本，不传或保存 session id。SDK 客户端可用 `Client` + `StreamableHTTPClientTransport` 并在 `requestInit.headers` 注入 Authorization。

L2 必须通过真实 Miniflare/workerd HTTP 覆盖 initialize、通知、九个工具的成功和拒绝、无 key、坏 key、非法 JSON / RPC / 参数、HTTP 方法和媒体类型、空间隐藏、并发同 ID 请求的无状态隔离以及审计不泄密；更新、删除后从 v1 验证数据与事务效果。本地测试不用任何远端 Cloudflare 资源。生产 bot 冒烟须在单独获准部署后执行，本分支不声称已完成生产接入。
