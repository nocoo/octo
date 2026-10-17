# 04 — REST API

> 返回 [文档目录](README.md)

Base URL：`https://octo.hexly.ai/api/v1`（本地：`https://octo.dev.hexly.ai/api/v1`）。只接受 JSON（附件上传除外）。认证用 `Authorization: Bearer octo_…`（见 [05](05-auth-permissions-audit.md)）。**没有速率限制。**

## 1. 通用约定

- 请求体和响应体都是 UTF-8 JSON，字段名用 `snake_case`，时间用 ISO 8601 UTC。
- 单个资源直接返回对象；列表返回 `{ "items": [...], "next_cursor": "…" | null }`。
- 每个响应都带 `X-Request-Id` 和 `X-Octo-Version`。
- 乐观并发：PATCH / rollback 必须带 `If-Match: <version>`（或 body 里的 `expected_version`）；不匹配返回 409。
- 未知字段 → 400 `validation_failed`（zod strict）。

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
| 409 | `version_conflict` / `tag_conflict` / `idempotency_conflict` | 并发冲突、标签名冲突、同一个幂等键对应了不同请求 |
| 413 | `payload_too_large` | 正文 > 1 MB、附件 > 50 MB、批量 > 100 条 |
| 415 | `unsupported_media_type` | 附件类型不在白名单 |
| 422 | `unprocessable` | 语义错误（例如回滚到不存在的版本） |
| 500 | `internal` | 未预期错误；不泄露内部细节 |
| 503 | `unavailable` | D1 / R2 暂时不可用 |

## 3. 幂等

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
| POST | `/memories` | write | 创建。body：`space`、`title`、`body`、`type`、`tags[]`、`importance?`、`event_time?`、`vector?` |
| GET | `/memories/:id` | read | `?include=versions_count,attachments,vector_status` |
| PATCH | `/memories/:id` | update | 部分更新 + `If-Match`；可以改 `space`（需要两边都有写权限，记为 `op=move`） |
| DELETE | `/memories/:id` | delete | 移入回收站；返回 `{trashed_at}` |
| GET | `/memories` | read | 过滤条件同搜索（spaces/tags/types/sources/time/importance）+ 游标 |
| POST | `/memories:batchCreate` | write | ≤100 条；每条结果单独给出（`results[i] = {ok, item|error}`），整体 207 风格但返回 200 |
| POST | `/memories:batchGet` | read | ≤100 个 id，带 `missing[]` |
| POST | `/memories:batchUpdate` | update | ≤100 条，每条都要带 expected_version |
| POST | `/memories:batchDelete` | delete | ≤100 个 id |
| PUT | `/memories/:id/vector` | update | 单独写或替换向量 `{profile, values}` |

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
| GET | `/changes` | read | `?cursor&limit&spaces[]`，按 seq 升序 |
| GET | `/changes/head` | read | 返回当前最新游标 |

### 标签与 space

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/tags` | read | 带使用次数（只按可见 space 计数） |
| POST | `/tags/:name/rename` | update + 全部 space 范围 | `{new_name}` |
| POST | `/tags/:name/merge` | update + 全部 space 范围 | `{into}` |
| GET | `/spaces` | read | 只列出可见的 space |
| GET | `/spaces/:slug` | read | 详情和计数 |

标签是全局的，重命名 / 合并会影响所有 space，所以要求 key 的范围是「全部」（admin 角色）。创建 space 只能在 dashboard 做；不过开了 `auto_own_space` 的 key 第一次写入时，会自动创建自己的 space（slug = key 名）。

### 附件

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/memories/:id/attachments` | update | `multipart/form-data` 或原始 body + `Content-Type` + `X-Filename`；返回附件元数据和 markdown 引用 `![](octo://att/<id>)` |
| GET | `/memories/:id/attachments` | read | 列表 |
| GET | `/attachments/:id/url` | read | 返回短时签名 URL `{url, expires_at}`（默认 5 分钟，见 02 §8） |
| GET | `/files/<r2_key>?exp&sig` | 签名 | 不需要 API key；签名和有效期校验通过后流式返回；`Content-Disposition`、`ETag`=sha256；SVG 强制 `attachment` 下载 |
| DELETE | `/attachments/:id` | delete | 软删除（随 memory purge 时物理删除） |

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

## 6. Admin API（只给 dashboard）

前缀 `/api/admin/*`，要求通过 Cloudflare Access JWT 校验，并且写请求必须同源（`Origin` 必须等于 `https://octo.hexly.ai`，开发环境是 `https://octo.dev.hexly.ai`）。功能：key 的增删改查、轮换、吊销；space 增删改；purge；审计查询；全局用量；embedding profile 管理；回收站批量操作；以及与 v1 对等的读写（actor 记为 `admin:<email>`）。详见 [05](05-auth-permissions-audit.md)、[06](06-dashboard.md)。

## 7. 示例

```bash
curl -s https://octo.hexly.ai/api/v1/memories \
  -H "Authorization: Bearer $OCTO_KEY" -H "Idempotency-Key: mig-000123" \
  -H 'Content-Type: application/json' \
  -d '{"space":"kb-bot","title":"Caddy 端口约定","body":"…","type":"procedure","tags":["infra","caddy"],"importance":0.8}'
```

最终的 API 文档（交付给知识库 bot）由 zod schema 生成 OpenAPI 3.1，放在 `GET /api/v1/openapi.json`，人读版本见 `docs/api/`（阶段 1 末尾生成）。
