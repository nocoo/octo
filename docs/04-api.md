# 04 — REST API

MCP 客户端使用独立的 `/mcp` 无状态 Streamable HTTP 端点，工具直接调用本章 API 的同一服务层而非 HTTP 自转发；九个工具的输入/输出 schema、错误语义及知识库 bot 配置见 [09](09-mcp.md)。REST 路由与信封保持不变。

> 返回 [文档目录](README.md)

Base URL：`https://octo.hexly.ai/api/v1`（本地：`https://octo.dev.hexly.ai/api/v1`）。只接受 JSON（附件上传除外）。认证用 `Authorization: Bearer octo_…`（见 [05](05-auth-permissions-audit.md)）。**没有速率限制。**

## 1. 通用约定

- 请求体和响应体都是 UTF-8 JSON，字段名用 `snake_case`，时间用 ISO 8601 UTC。
- 单个资源直接返回对象；列表返回 `{ "items": [...], "next_cursor": "…" | null }`。
- 每个响应都带 `X-Request-Id` 和 `X-Octo-Version`。
- 乐观并发：PATCH / rollback 必须带 `If-Match: <version>`（或 body 里的 `expected_version`）；不匹配返回 409。
- `importance` 在创建、更新、响应以及过滤器 `importance.min` / `importance.max` 中都是 0–1（含端点）的数值；创建时省略默认 0.5。上下限反转不会命中任何记录。
- 未知字段 → 400 `validation_failed`（zod strict）。
- 标签数组按提交顺序规范化、去重（保留第一次出现），响应不按字母排序；纯重排也是更新，产生新版本并出现在版本 diff 的 `tags` 字段中。重命名不重排，合并去重保留最靠前的位置。

## 2. 错误信封

```json
{ "error": { "code": "version_conflict", "message": "memory 01J… is at version 4, expected 3",
             "details": {"current_version": 4}, "request_id": "…" } }
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `validation_failed` | schema 不通过；`details.issues[]` 列出路径和原因 |
| 400 | `vector_dimension_mismatch` | 向量长度 ≠ profile.dims |
| 401 | `unauthenticated` | 缺 key、格式错、已吊销或过期（不区分具体原因） |
| 403 | `forbidden` | key 缺对应的操作权限，或者开启了「只改自己的」 |
| 404 | `not_found` | 资源不存在，**或**所在 space 对该 key 不可见 |
| 409 | `version_conflict` / `tag_conflict` / `tag_in_use` / `idempotency_conflict` | 并发冲突、标签名冲突、标签仍有引用或删除准备后发生变化、同一个幂等键对应了不同请求 |
| 413 | `payload_too_large` | 正文 > 1 MB、附件 > 50 MB、批量 > 100 条 |
| 415 | `unsupported_media_type` | 附件类型不在白名单 |
| 422 | `unprocessable` | 语义错误（例如回滚到不存在的版本） |
| 500 | `internal` | 未预期错误；不泄露内部细节 |
| 503 | `unavailable` | D1 / R2 暂时不可用 |

Unhandled errors emit one structured `console.error` JSON line with `event: "unhandled_error"`,
`request_id`, `method`, `path` (without the query string), and the error's `name` and `message`.
Request headers and bodies are not logged. Known `ApiError` responses do not emit this event;
unknown errors still return the generic `internal error` envelope without internal details.

## 3. 幂等

`If-Match` / `expected_version` 为 0 时执行正常的权限和乐观并发检查：单条 PATCH、rollback、vector PUT 返回 409 `version_conflict`；batchUpdate 在既有 HTTP 200 的逐项错误信封中返回同一 code；MCP 在 HTTP 200 工具错误中返回同一 code。负数、非整数或非法 header 仍为 400；隐藏/不可见资源仍为 404，不因版本检查泄露信息。rollback 的 `to_version` 仍须为正整数。

- 所有非 GET 的写请求都接受 `Idempotency-Key`（1–128 个可打印 ASCII 字符），作用域是 `(api_key, key)`。
- 第一次请求：执行后把 `request_hash`、状态码和响应体存进 `idempotency_records`。
- 重放：hash 相同就原样返回存下的响应，并带 `Idempotent-Replayed: true`；hash 不同返回 409 `idempotency_conflict`。
- 保留 7 天，由 cron 清理（这是请求记录，不是数据，所以不违反「永不自动清除」）。
- 批量接口把整个批次当作一个幂等单元。

## 4. 分页

- 游标分页，`limit` 默认 50、最大 200；游标是不透明的 base64url，包含排序键和 id（例如 `{"u":updated_at,"i":id}`）。
- list memories 的排序：`updated_at desc, id desc`（默认）或 `created_at`；按游标分页时结果稳定。
- 变更流用 `seq` 游标，见 02 §7。

## 5. 端点

### Memory

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/memories` | write | 创建。body：`space`、`title`、`body`、`type`、`tags[]`、`importance?`（0–1）、`event_time?`、`vector?` |
| GET | `/memories/:id` | read | `?include=versions_count,attachments,vector_status` |
| PATCH | `/memories/:id` | update | 部分更新 + `If-Match`；可以改 `space`（需要两边都有 update 权限，记为 `op=move`） |
| DELETE | `/memories/:id` | delete | 移入回收站；返回 `{trashed_at}` |
| GET | `/memories` | read | 过滤条件同搜索（spaces/tags/types/sources/time/importance，重要度上下限均为 0–1）+ 游标 |
| POST | `/memories:batchCreate` | write | ≤100 条；每条结果单独给出（`results[i] = {ok, item|error}`），整体 207 风格但返回 200 |
| POST | `/memories:batchGet` | read | ≤100 个 id，带 `missing[]` |
| POST | `/memories:batchUpdate` | update | `{items:[…]}`，≤100 条，每条使用下述 flat / patch 二选一格式 |
| POST | `/memories:batchDelete` | delete | ≤100 个 id |
| PUT | `/memories/:id/vector` | update | 单独写或替换向量 `{profile, values}` |

Vector PUT uses the same versioned write contract as PATCH: supply
`expected_version` in the body or the matching `If-Match` header. It requires
`u` permission (not `r`), returns the memory, increments its version only for an effective change,
and supports idempotency through the same atomic write boundary. The body is
`{profile,values,expected_version?}`, not a nested `vector` object.

`GET /memories/:id?include=vector_status` returns entries with
`{profile,indexed,stale,embedding_calls}` for active, stored or counted profiles.
`indexed` means the current vector upsert was accepted, not externally query-visible;
an active profile without a stored vector reports `indexed=false, stale=false`.
`embedding_calls` is the durable number of outbound embedding batch attempts in
which this memory/profile participated (including failed attempts); cache hits
and client-supplied vectors add zero. The count is permission-scoped through the
memory read, not a global provider counter. A changed-body PATCH can start
backfill before a later client PUT; its call must not be attributed to PUT.
See [vector convergence and smoke usage](vector-convergence.md).

`batchUpdate.items[]` 与 MCP `update_memory` 使用同一个严格输入规则，内部统一为 flat：

```json
{"items":[
  {"id":"memory-a","expected_version":1,"title":"更新标题","importance":0.8},
  {"id":"memory-b","patch":{"expected_version":2,"tags":["知识库","工作"]}}
]}
```

每条的 `id` 长度 1–64，`expected_version` 为非负整数（0 返回 version_conflict），且至少有一个可更新字段：`space`、`title`、`body`、`type`、`tags`、`importance`（0–1）、`event_time`、`vector`。使用 `patch` 时外层只能有 `id` 和 `patch`；即使字段不重复，也拒绝外层更新字段或外层 `expected_version`。内外层未知字段同样拒绝。任何结构错误都在写入前拒绝整个批次，HTTP 400 `validation_failed`；合法结构的业务失败仍按条返回 `{ok:false,error}`，整体 HTTP 200。幂等键仍覆盖整个批次。

单条 REST `PATCH /memories/:id` 仍使用 flat 更新字段（不接收 `patch` 包装），版本通过 `If-Match` 或 body 的 `expected_version` 提供；同时提供时必须一致。`POST /memories/:id/rollback` 是 `{"to_version":1}` + `If-Match: 3`，或 `{"to_version":1,"expected_version":3}`，不是 `version` 或 `patch`。`to_version` 为要恢复的历史版本，乐观锁版本为当前版本。

**无有效变化的更新：** `PATCH /memories/:id`、`batchUpdate.items[]`、MCP `update_memory`（以及共用写路径的 vector PUT）在规范化后的完整结果与当前资源相同时，直接返回当前资源；REST HTTP 200，批量条目为 `{ok:true,item}`。不增加 `version`，不改 `updated_at` / `updated_by_key_id`，不写版本快照、变更事件、标签关联、FTS 或向量，也不触发派生同步。空间按解析后的 ID 比较；标签先规范化、跟随合并别名、按第一次出现去重，再比较身份和顺序，因此大小写或兼容字符差异可为无变化，纯重排仍是有效更新。标量逐字段比较，`event_time` 按 UTC 时间戳比较；省略向量保留现状，没有向量时再次传 `vector:null` 为无变化。同一 profile、模型、维度和内容哈希下，L2 归一化为相同 float32 值的向量也为无变化；替换、删除已有向量或刷新过期内容哈希仍是有效更新。

权限、输入及乐观锁检查先于无变化短路：相同字段配上错误的 `expected_version` 仍返回 409 `version_conflict`（批量为该条 `{ok:false,error}`；MCP 使用工具错误信封）。同批次重复 ID 按条观察先前暂存的资源、标签和向量状态；无变化的条目不消耗版本号。审计及请求幂等记录仍按原契约执行，MCP 无变化更新不记为已提交写入。回滚和恢复不属于无变化短路，仍创建新版本。

### 版本

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/memories/:id/versions` | read | 版本列表（元数据，不含正文） |
| GET | `/memories/:id/versions/:v` | read | 完整快照 |
| GET | `/memories/:id/diff?from=a&to=b` | read | 字段级差异 + 正文 unified diff 与 hunk 结构 |
| POST | `/memories/:id/rollback` | update | `{to_version}` + `If-Match`；生成新版本 |

### 搜索与增量

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/search` | read | 见 [03](03-search.md) |
| GET | `/changes` | read | `?cursor&limit&spaces=slug-a,slug-b`，按 seq 升序 |
| GET | `/changes/head` | read | 返回当前最新游标 |

### 标签与 space

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/tags` | read | 只返回可见 space 内未删除 memory 正在使用的标签；`use_count` 只统计这些引用，零引用标签不返回。Access 后台列表保持完整字典 |
| POST | `/tags/:name/rename` | update + 全部 space 范围 | `{new_name}` |
| POST | `/tags/:name/merge` | update + 全部 space 范围 | `{into}` |
| DELETE | `/tags/:name` | update (`u`) + `scope=all` | 无请求体；成功 `{name,deleted:true}`，不存在 404，仍有引用 409 `tag_in_use`；支持幂等键 |
| GET | `/spaces` | read | 只列出可见的 space |
| GET | `/spaces/:slug` | read | 详情和计数 |

标签是全局的，重命名 / 合并 / 删除要求 `scope=all` 和 `u`（不限定角色名称）。删除检查所有空间的 `memory_tags`，包括已删除 memory；因此 API 列表里不可见或 `use_count=0` 并不表示可删除。其他标签通过 `merged_into` 引用该标签也会阻止删除；先删除无引用的叶子别名，再删除目标，不级联删除、不改变历史版本中的名称。并发新增引用或修改目标使删除事务失败，不能绕过重验。所有请求记录审计，清理不用新增 MCP 工具；手动操作见 [清理手册](tag-cleanup.md)，本轮不执行生产清理。

创建 space 只能在 dashboard 做；不过开了 `auto_own_space` 的 key 第一次写入时，会自动创建自己的 space（slug = key 名）。

### 附件

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/memories/:id/attachments` | update | `multipart/form-data` 或原始 body + `Content-Type` + `X-Filename`；返回附件元数据和 markdown 引用 `![](octo://att/<id>)` |
| GET | `/memories/:id/attachments` | read | 列表 |
| GET | `/attachments/:id/url` | read | 返回短时签名 URL `{url, expires_at}`（默认 5 分钟，见 02 §8） |
| GET | `/files/<r2_key>?exp&sig`（站点根路径，不带 `/api/v1`） | 签名 | 不需要 API key；签名和有效期校验通过后流式返回；`Content-Disposition`、`ETag`=sha256；SVG 强制 `attachment` 下载 |
| DELETE | `/attachments/:id` | delete | 软删除（随 memory purge 时物理删除） |

Multipart uploads accept exactly one `file` part (no extra fields), with at most 50 MiB of file bytes and 64 KiB of envelope bytes. Raw uploads accept at most 50 MiB. Declared oversize requests are rejected before acquiring a body reader; the runtime owns cleanup of that unused body. Actual bytes are bounded while reading; on overflow, the application stops reading and releases its reader lock without cancelling the transport before the error response. The runtime terminates the incoming stream when the response proxy task completes or the client disconnects; see [the ownership proof](07-dev-workflow.md#7-attachment-early-response-proof). Keyed uploads identify the validated filename, normalized content type and SHA-256 of file bytes; multipart boundaries do not affect replay identity. Attachment mutations, change events and replay outcomes commit in one D1 batch.

### 回收站

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/trash` | delete | 列出可见 space 内已删除的条目 |
| POST | `/trash/:id/restore` | delete | 恢复 |

**不提供** purge API；硬删除只在 `/api/admin/*`（Access）里。

### 自省与用量

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/me` | 任意有效 key | key 名、角色、权限、可见 space、过期时间（不返回 key 本身） |
| GET | `/usage?from&to` | 任意有效 key | 本 key 的按日调用数、错误数、写入字节数 |
| GET | `/embedding-profiles` | read | 可用的 profile 和活跃 profile |

### 不可见空间的逐端点行为

以下均以有效 key、具备端点操作权限、合法输入为前提；没有 key 返回 401，缺操作权限返回 403，输入校验可能先返回 400。不可见空间与不存在资源不加区分，不透露正文、标签、计数或版本。列表的空间参数采用 `spaces=slug-a,slug-b`；搜索 JSON 使用 `filters.spaces`，两者均与 key 的可见空间求交集（未知空间也被过滤）。

| 方法与路径 | 目标空间不可见时 |
|---|---|
| `POST /memories` | 404 `not_found`，不创建记录 |
| `GET /memories/:id` | 404 `not_found`，即使带 `include=trashed` 或其他扩展 |
| `PATCH /memories/:id` | 源空间或移动目标空间任一不可见即 404，不更新 |
| `DELETE /memories/:id` | 404，不移入回收站 |
| `PUT /memories/:id/vector` | 404，不写向量 |
| `GET /memories` | 200，仅可见结果；交集为空时 `{items:[],next_cursor:null}` |
| `POST /memories:batchCreate` | 200，该条 `{ok:false,error:{code:"not_found",…}}`；其他合法条目继续处理 |
| `POST /memories:batchGet` | 200，隐藏、已删除或不存在的 id 进入 `missing[]`，不进入 `items[]` |
| `POST /memories:batchUpdate` | 200，源或移动目标不可见的该条为 `not_found`，不修改该条 |
| `POST /memories:batchDelete` | 200，该条为 `not_found`，不删除该条 |
| `GET /memories/:id/versions` | 404，不返回版本列表 |
| `GET /memories/:id/versions/:v` | 404，不返回历史快照 |
| `GET /memories/:id/diff` | 404，不计算或返回差异 |
| `POST /memories/:id/rollback` | 当前空间或历史快照的目标空间不可见时 404，不回滚 |
| `POST /search` | 200，FTS / vector / hybrid 均过滤不可见记录，D1 复验候选；交集为空时结果及候选计数为零 |
| `GET /changes` | 200，仅可见空间的事件；交集为空时空列表 |
| `GET /changes/head` | 200，游标只取可见事件的最高序号；交集为空时游标编码 `{"s":0}` |
| `GET /tags` | 200，仅可见空间内未删除 memory 使用的标签及其可见引用数 |
| `POST /tags/:name/rename` | 全局操作；非 `scope=all` 或缺 `u` 返回 403，不通过名称探测其他空间 |
| `POST /tags/:name/merge` | 同上 |
| `DELETE /tags/:name` | 同上；仅全局 `u` 可检查所有空间与回收站引用，不允许 scoped key 推断标签是否存在或仍在使用 |
| `GET /spaces` | 200，仅可见空间及其未删除 memory 计数 |
| `GET /spaces/:slug` | 404，不返回详情或计数 |
| `POST /memories/:id/attachments` | 404，在读取上传内容前拒绝 |
| `GET /memories/:id/attachments` | 404，不是空列表 |
| `GET /attachments/:id/url` | 所属 memory 不可见时 404，不签发 URL |
| `DELETE /attachments/:id` | 所属 memory 不可见时 404，不软删除附件 |
| `GET /files/<r2_key>?exp&sig` | 不读取 API key 空间权限；已签发 URL 是到期前有效的下载凭证，不能把它当成再次鉴权 |
| `GET /trash` | 200，仅可见空间的回收站记录 |
| `POST /trash/:id/restore` | 404，不恢复 |
| `GET /me` | 200，返回当前 key 自身的权限与可见空间，不提供查询其他 key 的入口 |
| `GET /usage` | 200，只返回当前 key 的用量，不按空间查询其他 key |
| `GET /embedding-profiles` | 200，返回全局模型配置的公开元数据；不返回 embedding 网关设置或凭据 |

直接 HTTP 验证见 `tests/api/memories-matrix.test.ts`、`batch.test.ts`、`search.test.ts`、`attachments.test.ts`、`spaces.test.ts` 及本轮新增回归。MCP 对应工具复用相同服务与错误 code，外层遵循 [09](09-mcp.md) 的 HTTP 200 + `isError` 约定。

## 6. Admin API（只给 dashboard）

`POST /api/admin/settings/search/backfill`：无正文，使用 Cloudflare Access 与同源 Origin 验证，推进最多 100 个 tag/memory 的分词索引回填，返回 `{tags, memories, complete}`。操作幂等可恢复，不修改 memory 版本；部署顺序、预算和完成检查见 [回填手册](round3-validation.md)。

前缀 `/api/admin/*`，要求通过 Cloudflare Access JWT 校验，并且写请求必须同源（`Origin` 必须等于 `https://octo.hexly.ai`，开发环境是 `https://octo.dev.hexly.ai`）。功能：key 的增删改查、轮换、吊销；space 增删改；purge；审计查询；全局用量；embedding profile 管理；向量模型设置（`GET/PUT /api/admin/settings/embedding`，API key 只能写；`POST …/test` 测试连接）；回收站批量操作；以及与 v1 对等的读写（actor 记为 `admin:<email>`）。详见 [05](05-auth-permissions-audit.md)、[06](06-dashboard.md)。

### M7 dashboard contract

All paths below are relative to `/api/admin`. Responses use the existing raw JSON
success payload and standard error envelope. No API key, including the `admin` role, authorizes
these routes. Write requests require both Access and the allowed Origin.

| Method | Path | Request / behavior |
|---|---|---|
| GET / POST | `/keys` | List sanitized metadata / mint a role template |
| GET / PATCH | `/keys/:id` | Read / edit permissions |
| DELETE | `/keys/:id` | Permanently delete a revoked key; active keys return 409 |
| POST | `/keys/:id/rotate` | `{grace_ms?: 0..604800000}`; default zero |
| POST | `/keys/:id/revoke` | Immediately revoke, retaining the key and history |
| GET / POST | `/spaces` | List / create `{slug,name,description?,owner_key_id?}` |
| GET / PATCH / DELETE | `/spaces/:slug` | Read / edit / delete only when empty, including trash |
| GET | `/audit` | Filter by `from,to,actor,action,status`; opaque `cursor`, bounded `limit` |
| GET | `/usage` | UTC daily rows; `from,to,key_id?` |
| GET | `/embedding-profiles` | Profile discovery, identical payload to v1 |
| GET / PUT | `/settings/embedding` | Read sanitized configuration / atomically save fields |
| POST | `/settings/embedding/test` | Current configuration or unsaved overrides; fixed probe text |
| DELETE | `/trash/:id` | Purge a trashed memory; durable external cleanup |

### 回收站批量管理

仅 `/api/admin` 提供这些接口；必须通过 Access，写请求还必须通过同源检查。`/api/v1/trash` 不受此扩展影响。

| 方法 | 路径 | 请求 / 响应 |
|---|---|---|
| GET | `/trash` | `q?,space?,limit?,cursor?` → `{items,total,next_cursor}` |
| POST | `/trash:batchRestore` | `{ids}` → `{results,succeeded,failed}` |
| POST | `/trash:batchPurge` | `{ids}` → `{results,succeeded,failed}` |
| POST | `/trash:empty` | `{filters?:{q?,space?},expected_count?,cursor?}` → `{results,purged,remaining,next_cursor}` |

- `q` 最长 500 字符，去除首尾空白，仅匹配标题或标签的字面子串；ASCII 不区分大小写，`%`、`_` 不作为通配符。`space` 使用 slug。未知字段、重复查询参数或无效游标均返回 400；`limit` 默认 25，范围 1–200。
- 列表只返回记忆元数据和标签，不读取或返回 `body`，避免 200 条大正文超出 Worker 内存预算。按 ID 降序分页，游标经 HMAC 签名并绑定筛选条件和变更水位。分页排除水位之后新加入或变化的记忆，以及关联空间或标签的后续变更；`total` 是该快照当前仍匹配的数量，不是本页长度。全量选择必须完整枚举分页，不能把第一页当作全部。
- 批量 ID 数量为 1–100，重复、空值或非法类型返回 400，超过 100 返回 413。`results` 保留请求顺序，每项为 `{id,ok,error?:{code,message}}`；单项失败不阻止其他项，内部错误信息不会返回。恢复复用单条恢复事务；彻底删除复用单条删除事务，缺失 ID 视为幂等成功。重复恢复不会生成额外版本。
- 清空每次最多处理 10 条。初始请求的 `expected_count` 与当前匹配总数不一致时返回 409，不开始删除。续传使用相同筛选和原始确认数量，不以 `remaining` 替代原始数量。
- 清空游标签名绑定初始变更水位、筛选、确认总数和下一批最多 10 个 ID；重放同一续传请求只重试这一批，不滑动到后面的记录。每条删除事务内部重新核对水位和当前版本，拒绝并发变化；之后新增、恢复后重新删除、改名或移入范围的记录不会被续传纳入。
- `purged` 是本次实际删除数；已缺失的幂等成功不重复计数。`remaining` 包括快照中仍匹配但处理失败的记录，故可能大于零而 `next_cursor` 为 null；此时应显示失败项，停止自动循环，重新确认后重试。初始请求响应丢失后，带原确认数量重试可能返回 409；不能自动删除计数检查以继续。
- D1 删除和 R2 清理任务、向量同步墓碑一起持久化。批量请求后台最多清理 10 个 R2 对象、协调 5 个向量任务；未完成任务留给后续请求或定时补偿。审计按调用保存请求项数、成功数、失败数，不保存 ID 列表或请求正文。

Key metadata uses snake_case fields from the permission model, with `space_ids`
as an array of existing space IDs from `GET /api/admin/spaces` `items[].id`,
not `items[].slug`. Boolean flags must be JSON booleans. Role templates are `admin`, `project`, `drop`,
`readonly`, and `custom`. Mint and rotate return `{key,plaintext}` exactly once;
other responses never include plaintext or either secret hash.

Create requires `{name,role}`; custom roles additionally require `ops` (a
comma-separated string of unique flags from `r,w,u,d`, not an array) and
`scope` (`all`, `spaces`, or `own`). An empty `ops` string grants no operations.
Optional fields are `space_ids`, `own_entries_only`, `auto_own_space`, and
`expires_at` (ISO UTC ending in `Z`, or null). Requests use a flat strict object;
nested `permissions`, stored-format aliases and other extra fields are rejected.
PATCH accepts a nonempty subset of these fields. `space_ids` must be unique,
and a nonempty list is only valid with `scope: "spaces"`.

| Role | Fixed `ops` | Permitted `scope` | Fixed `auto_own_space` |
|---|---|---|---|
| `admin` | `r,w,u,d` | `all` | `false` |
| `project` | `r,w,u,d` | `own` | `true` |
| `drop` | `w` | `spaces` (default), `own` | `false` |
| `readonly` | `r` | `all` (default), `spaces` | `false` |

Templates reject incompatible permission overrides; use `custom` to choose
`ops`, `scope` and `auto_own_space` independently. Custom `auto_own_space`
defaults to `false`; all roles default `own_entries_only` to `false` and
`space_ids` to `[]`. These defaults apply on create or a role change. Otherwise,
PATCH preserves omitted permissions. Expiry defaults to null on create and
is preserved when omitted from PATCH, including a role change.
Metadata includes `id,name,role,ops,scope,space_ids,own_entries_only,auto_own_space`
and nullable ISO timestamps `expires_at,revoked_at,last_used_at`, plus
`created_at,updated_at`. Read, PATCH and revoke return this metadata object.
Key lists and space lists return `{items,next_cursor:null}`. Space PATCH uses
the create fields, all optional; deletion returns `{id,slug,deleted:true}`.
Key administration is recorded only in the protected audit log, never the
public memory/space change stream.
`DELETE /api/admin/keys/:id` is Access-admin-only and requires the same-origin
write check. It accepts no body and returns `200 {id,deleted:true}` only after
permanently removing an already revoked key. An unrevoked key, including an
expired key, returns `409 version_conflict`; revoke it first with
`POST /api/admin/keys/:id/revoke`. The delete is conditional on the key still
being revoked and its metadata revision remaining unchanged; a concurrent
change returns `409 version_conflict`. Missing keys, including repeat deletes,
return `404 not_found`. The deleted key disappears from metadata reads and
lists. Existing audit records, usage rows, owned spaces and memory attribution
retain their original key IDs. Successful, conflicting and missing delete
requests are audited through the standard request audit middleware.
Spaces remain editable after their owner key is deleted. Space updates retain
an unchanged historical owner ID and validate only a newly assigned owner.
Space slugs are 1–64 lowercase alphanumeric characters with single interior
hyphens. Keys with `auto_own_space` enabled, including `project`, require a name
meeting the same slug contract so their space can be used by memory writes.
This also applies when PATCH enables auto-own for an existing display name.
Key schema and semantic validation errors return `validation_failed` with
`details.issues[]` entries containing a dot-separated `path` and `message`.
Unknown space IDs identify `space_ids`; auto-owned name violations identify
`name`; missing custom permissions and incompatible template overrides identify
the affected permission fields. Semantic messages do not echo submitted values.
Object-level errors, such as extra keys or an empty PATCH, use an empty path
and should be shown at form level.

```json
{"error":{"code":"validation_failed","message":"unknown space id","details":{"issues":[{"path":"space_ids","message":"unknown space id"}]},"request_id":"…"}}
```

Audit returns `{items,next_cursor}`. Items contain
`id,at,actor,method,route,status,error_code,request_id,duration_ms,bytes_in,bytes_out,ip_hash`.
`at` is ISO UTC; byte counts and `ip_hash` can be null. `action` matches the
normalized route template exactly (or `unmatched`), not the HTTP method or raw
URL. `from`/`to` accept UTC dates or ISO-Z timestamps; day bounds are inclusive.
Usage 返回 `{items,next_cursor}`，每日行结构为
`{day,key_id,calls,errors,writes,bytes_in,bytes_out}`，随审计 batch 提交实时增量更新；
小时 cron 仅负责幂等修复，查询时不会重新扫描审计日志。日期范围包含起止 UTC 日期。
Without `key_id`, admin usage lists per-day/per-key rows; v1 always uses the
authenticated key and ignores a supplied `key_id`. Both endpoints accept
`limit` (1–200, default 50) and signed cursors bound to the effective filters
and, for v1 usage, caller identity. Unknown, duplicate or malformed query
parameters return `validation_failed`.

Profiles return `{items,active_profile,next_cursor:null}`; each item has
`{id,model,dims,metric,active,created_at}` with boolean `active` and ISO UTC
`created_at`. Profile mutation is not part of M7.

Embedding fields are `base_url,model,dims,backfill_enabled`. GET additionally
returns `api_key_set` and `api_key_mask` (only the last four characters). PUT
omitting `api_key` preserves it, `null` clears it, and a nonempty string replaces
it. Model/dimensions must match the active profile. Test returns only
`{latency_ms,dims,match,error_code,reason}`; no upstream response body, credential,
full URL, host, or secret string. `dims` is a number or null, and `error_code` is
null, `embedder_unavailable`, or `vector_dimension_mismatch`. `reason` is required:
null on success, otherwise
`{stage:"config"|"decrypt"|"request"|"status"|"redirect"|"timeout"|"parse"|"dims",
upstream_status?: number}` (HTTP status only for `status`/`redirect`). Gateway
requests reject redirects (`redirect:"manual"`), use a five-second timeout, and
join `base_url` as a root or trailing `/v1` without duplicating `/v1`. Structured
failure logs emit only safe `{event,stage,upstream_status?,host}` fields. An empty
test body `{}` uses saved settings; partial fields override without persisting.
Concurrent PUTs compare the complete observed settings snapshot and reject a stale
save with `validation_failed`, rather than pairing newer credentials with an old
URL. `OCTO_SETTINGS_KEY` must be canonical base64 encoding exactly 32 random bytes.

Memory, version, diff, rollback, batch, trash/restore, changes, tags, attachments,
and search endpoints mirror their `/api/v1` methods and suffixes under this
prefix, reuse the same services and atomic transaction boundary, and record
`admin:<email>` as actor. Purge has no `/api/v1` equivalent.
Purge returns `{id,purged:true}` after the D1 commit; Vectorize and R2 cleanup
are durable asynchronous work. Admin text search uses the configured gateway
for hybrid search unless `mode: "fts"` is explicit; an unavailable gateway falls
back to FTS with `channels.vector.skipped: "embedder_unavailable"`. V1 never
uses the server-side embedding credential.

## 7. 示例

```bash
curl -s https://octo.hexly.ai/api/v1/memories \
  -H "Authorization: Bearer $OCTO_KEY" -H "Idempotency-Key: mig-000123" \
  -H 'Content-Type: application/json' \
  -d '{"space":"kb-bot","title":"Caddy 端口约定","body":"…","type":"procedure","tags":["infra","caddy"],"importance":0.8}'
```

最终的 API 文档（交付给知识库 bot）由 zod schema 生成 OpenAPI 3.1，放在 `GET /api/v1/openapi.json`，人读版本见 `docs/api/`（阶段 1 末尾生成）。
