# 05 — 认证、权限与审计

> 返回 [文档目录](README.md)

## 1. 两种身份

| 入口 | 认证 | 身份 |
|---|---|---|
| `/api/v1/*`、`/mcp` | `Authorization: Bearer octo_<keyid>_<secret>` | API key = agent |
| `/`（SPA）、`/api/admin/*` | Cloudflare Access JWT | Zheng（`admin:<email>`），拥有全部权限 |

## 2. Cloudflare Access（已配置）

MCP 每个 HTTP 请求独立鉴权，不接受 Access JWT 代替 key。工具调用复用 v1 权限和空间可见性；HTTP 200 内的工具错误同样写入审计 error_code。带 Origin 的 MCP 请求只允许当前环境的固定同源域名，无 Origin 的 bot 请求正常接受。详细协议与审计边界见 [09](09-mcp.md)。

- Team domain：`nocoo` → `https://nocoo.cloudflareaccess.com`
- Application AUD：`9ab761cffd4ad657004e429d74e5524232d3b017775548211f5e0eb809a88d67`
- 两者都**不是 secret**，可以进版本库。照搬 giraffe（`apps/web/src/server/lib/access-config.ts` + `middleware/access.ts`）：生产值写成代码常量 `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`；只有测试环境才读取 env 覆盖 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` / `ACCESS_JWKS_URL`（三个必须同时给出），生产环境忽略这些覆盖。
- Access 应用保护 `octo.hexly.ai` 整站，但对 `/api/v1/*`、`/mcp` 配置 **bypass**（这些路径由 Worker 用 API key 鉴权，和 giraffe 的 `/api/v1/*` 做法一样）。
- **Worker 端校验（照搬 giraffe 的做法，不信任「Access 已经拦过」）：**
  1. 读取 `Cf-Access-Jwt-Assertion` 请求头（不接受 cookie）；
  2. 从 `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`（即 `https://nocoo.cloudflareaccess.com/cdn-cgi/access/certs`）拉 JWKS，按 `kid` 选公钥，模块级缓存 10 分钟，`kid` 不在缓存里时强制刷新一次；
  3. 校验 RS256 签名、`iss === ACCESS_TEAM_DOMAIN`、`aud` 包含 `ACCESS_AUD`、`exp` / `nbf`（允许 60 秒时钟偏差）；
  4. 取 `email` 作为 actor。任何一步失败：返回 401 `unauthenticated`。
- 生产环境忽略所有测试用 JWKS 覆盖项。L2 用本地 JWKS stub 加自签 token，并且只在 `RESOURCE_ENV=test` 且请求来自 loopback 时才生效（giraffe 的 suite B 就是这样）。
- 本地日常开发：`.dev.vars` 设置 `ACCESS_DEV_BYPASS_EMAIL`，只有在 `RESOURCE_ENV=development` 且 host 是 `octo.dev.hexly.ai` 或 loopback 时才生效；生产构建会断言这个值为空。
- Local config generation removes custom-domain routes to preserve the development Host; `bun run build` rejects a nonempty bypass in the process, Vite production environment or deployment bindings, without reading `.dev.vars`.

## 3. API key

- 格式：`octo_<keyid>_<secret>`。`keyid` 是 12 位 base32，`secret` 是 32 字节随机数的 base32。
- 存储：只存 `HMAC-SHA256(API_KEY_PEPPER, secret)` 和 `keyid`，查找时按 `keyid` 定位再做常量时间比较。明文**只在创建 / 轮换的响应里出现一次**，不写日志、URL、D1 或浏览器持久化存储。
- 生命周期：`expires_at` 可选；轮换 = 生成新 secret，旧 secret 在可选的宽限期（默认 0，最多 7 天）后失效；吊销立即生效。
- **只能在 dashboard 管理**，v1 API 不暴露 key 或权限管理。

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,            -- keyid
  name TEXT NOT NULL UNIQUE,      -- agent 名，如 "kb-bot"
  secret_hash TEXT NOT NULL,
  prev_secret_hash TEXT, prev_valid_until INTEGER,
  role TEXT NOT NULL,             -- admin|project|drop|readonly|custom
  ops TEXT NOT NULL,              -- 'r,w,u,d' 子集
  scope TEXT NOT NULL,            -- all|spaces|own
  space_ids_json TEXT NOT NULL DEFAULT '[]',
  own_entries_only INTEGER NOT NULL DEFAULT 0, -- update/delete 只能作用于 source_key_id=自己的条目
  auto_own_space INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER, revoked_at INTEGER, last_used_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
```

## 4. 权限模型

判定函数是一个纯函数 `authorize(key, op, target) → allow | deny(not_found|forbidden)`，L1 要做全组合测试。

- **操作：** read / write（创建）/ update / delete（含回收站和恢复），可以任意组合。
- **范围：** `all`（所有 space）、`spaces`（列出的 space）、`own`（`spaces.owner_key_id = key.id` 的 space）。
- **只改自己的：** 开启后，update / delete 只能作用于 `source_key_id = key.id` 的条目，否则返回 403。
- **默认拒绝：** 没有显式允许的都拒绝。**范围外的 space 是不可见的**：返回 404，list 和搜索里不出现，计数里也不算。
- **跨 space 搬移：** 源和目标 space 都需要 update 权限。
- **全局标签操作**（rename / merge / delete）：要求 `scope=all` 且有 update (`u`) 权限，角色名称不限；缺任一条件返回 403，幂等重放前也必须重验权限。显式删除仅允许全局没有 memory 引用（包括回收站）且没有合并别名指向的标签，否则 409 `tag_in_use`；不级联删除或泄露 scoped key 看不到的引用。

角色模板（dashboard 创建 key 时选；本质上是预设的 ops / scope，可以改成 custom）：

| 模板 | ops | scope | 备注 |
|---|---|---|---|
| admin | r,w,u,d | all | 全部数据操作；**不能**管理 key（API 本来也没有 key 管理） |
| project | r,w,u,d | own | 自己的 space 读写；`auto_own_space=1` |
| drop | w | spaces 或 own | 只写入口，读不到任何内容（包括自己写的） |
| readonly | r | all 或 spaces | 只读 |

## 5. 审计

每次 API 调用（包括 401 / 403 / 404）和每个 admin 操作都写一行：

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,           -- ULID
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,           -- key:<id> | admin:<email> | anonymous
  method TEXT NOT NULL, route TEXT NOT NULL,   -- 路由模板，如 /api/v1/memories/:id
  status INTEGER NOT NULL, error_code TEXT,
  space_id TEXT, entity_id TEXT,
  request_id TEXT NOT NULL, idem_key TEXT,
  duration_ms INTEGER NOT NULL,
  bytes_in INTEGER, bytes_out INTEGER,
  ip_hash TEXT, user_agent TEXT  -- ip 用 pepper 做 HMAC，不存明文
);
CREATE INDEX audit_at ON audit_log(at);
CREATE INDEX audit_actor_at ON audit_log(actor, at);

CREATE TABLE mcp_audit_writes (
  audit_id TEXT PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE
) WITHOUT ROWID;
```

- 响应就绪后用 `ctx.waitUntil` 跟踪字节计数和审计写入，不等待 D1 才返回响应；写失败只记录固定码 `audit_write_failed`，不记录异常内容。
- 绝不记录请求体、正文或 key。
- 永久保留（Zheng 2026-10-17 决定）；dashboard 健康页监控 D1 体积。

### 5.1 字节口径

- `bytes_in` 仍只读取合法的请求 `Content-Length`，缺失或非法时为 `NULL`；不为统计读取或排空上传流。
- `bytes_out` 对 `HEAD` 或没有 body 的响应记为 `0`，即使长度头描述了 GET 表示的大小。其他响应优先信任合法 `Content-Length`，不读取 body，也不验证长度是否与实际传输一致；客户端提前断开时仍记声明长度。合法长度沿用边界：1–10 位十进制数字，数值在 `0` 至 `4294967295` 之间。
- 缺失或非法响应长度头时，以单路 `TransformStream` 透传，累加成功入队的 `Uint8Array.byteLength`。UTF-8 文本按编码后的字节计，不按字符数计；二进制原样透传。不使用 `clone()` / `tee()` 或整份 body 缓冲，输出队列最多一块，保留源流和管线自身的有界预读及背压，不随慢客户端积压完整响应。
- 未知长度响应在 EOF、客户端取消或源流错误使管线结束后写审计；取消向源传播，源错误仍传给响应读取者。失败/取消时只记已经过计数流的前缀，HTTP 状态和业务错误码不改写。`duration_ms` 仍是响应就绪耗时，不含流传输和 D1 写入耗时。
- 当前 `compatibility_date=2026-04-01` 已启用标准 `TransformStream` 构造器（2022-11-30 起）及背压修复（2024-12-16 起）；无需额外兼容标志，依据见 [Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)。
- 这是应用层响应 body 字节，不包括 HTTP 头、分块封装或平台后续压缩等传输开销，也不是客户端已确认收到的字节。输出队列里的字节可能在取消/错误时未抵达客户端。未知长度的未终止流暂没有审计行；运行时终止或响应完成/断连后的 `waitUntil` 共享 30 秒预算耗尽可能导致该行缺失，不承诺持久化投递（[Workers Context](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)）。

## 6. 用量统计（替代速率限制）

- cron 每小时把 `audit_log` 汇总到 `usage_daily(day, key_id, calls, errors, writes, bytes_in, bytes_out)`；用 upsert，重复跑结果不变。
- `/api/v1/usage` 只返回调用者自己的数据；dashboard 能看所有 key。
- 汇总只包含已经写入的审计行；流结束后迟到的行会在下一次 cron 纳入。修复前，普通 JSON 响应未提供 `Content-Length`，审计写入 `bytes_out=NULL`，汇总按 `0` 处理；旧响应正文从未保存，无法据此回填真实字节数。
