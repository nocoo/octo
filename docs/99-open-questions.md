# 99 — 待决问题

> 返回 [文档目录](README.md)

## 已决（2026-10-17）

| 事项 | 决定 | 见 |
|---|---|---|
| 域名 | 本地 `octo.dev.hexly.ai`，生产 `octo.hexly.ai` | 01 |
| Cloudflare Access | team `nocoo`，AUD `9ab761cf…88d67`，Worker 校验 JWT | 05 §2 |
| 速率限制 / Durable Objects | 都不做 | 01 |
| MCP | 阶段 2 | 08 |
| 并行开发 | MacBook herdr + Cursor cloud agents；Mac Studio 不参与 | 08 |
| 向量 | `text-embedding-3-small`，1536 维，cosine；写入时服务端 L2 归一化；每条记录存模型和维度 | 03 §2 |
| Dashboard 查询向量 | dashboard「向量模型」设置页（只走 Access）：base URL、AES-GCM 加密保存的 API key、model、dims、测试连接；始终带 User-Agent；未配置时降级为全文 + 过滤 | 03 §2.1 |
| 服务端补向量 | 可选开关，默认关；异步 `waitUntil`，失败只记日志 | 03 §2.1 |
| 附件下载 | 短时 HMAC 签名 URL（默认 5 分钟），以后可以把 host 换成 CDN 域名 | 02 §8 |
| 审计日志 | 永久保留 | 05 §5 |
| 本地端口 | 7059 / 17059 / 27059 / 37059 | 07 §3 |
| 大小上限 | 正文 1 MB，附件 50 MB | 04 §2 |
| `type` 白名单 | fact / preference / decision / procedure / event / log / note，可以在 dashboard 扩展 | 02 |
| Nowledge Mem 迁移 | 不在 octo 范围内，由知识库 bot 用 v1 API 完成；不加迁移专用字段 | 08 |

## 仍待决

| # | 问题 | 当前默认 |
|---|---|---|
| 1 | R2 的 CDN 域名（由 Zheng 以后配置） | 签名 URL 暂时由 Worker 的 `/files/*` 提供 |

## Known issues

### M5: local Wrangler proxy can return 500 after an oversized upload

Accepted by Zheng on 2026-10-17. With Wrangler `4.145.0`, Miniflare
`5.20260930.0-alpha` and workerd `1.20260930.2`, the local `wrangler dev --local`
proxy reports `Network connection lost` and returns 500 instead of the required
413 in three finite-upload scenarios. This is a documented acceptance exception,
not a change to the production API contract or proof of safe connection reuse.

The following scenarios were removed from `tests/api/attachments.test.ts`,
rather than skipped or allowed through a weaker gate:

- `rejects chunked oversize multipart requests` (only the multipart case).
- The keyed declared-oversize assertion in `rejects binary replay conflicts and keyed declared oversize`.
- `bounds keyed chunked multipart uploads before hashing` (only the multipart case).

The binary replay-conflict 409 assertion remains as its own test. Both raw
chunked cases, other multipart/boundary checks, all L1 upload tests and all
seven native-owner early-response L2 cases remain enabled. There is no skip
allowlist, expected-failure conversion, request retry or pre-push bypass.

Evidence at pre-exception HEAD `fd2b84bc1870ee3bad5620a5db7d45a63cd067d0`:
the complete L2 run had 111 passes and exactly these three failures. A paired
standalone reproduction sends a finite 2 MiB chunked POST to a 1 MiB-limit
Worker, consumes its 413, then sends `POST /ok`. Direct Miniflare/workerd passed
all ten pairs; equivalent Wrangler-local execution returned 500 for the next
POST on trial 0 and the oversized POST on trial 9. Neither reproduction uses
Octo, authentication, D1, R2, retries, delays or client-connection workarounds.
Scripts, logs and pinned runtime source remain in the controller's M5 evidence
archive, referenced by its signoff report. These results implicate the extra
proxy path; the precise internal race and production behavior are unproven.

Related upstream reports: [workers-sdk #15709](https://github.com/cloudflare/workers-sdk/issues/15709)
and [workerd #1741](https://github.com/cloudflare/workerd/issues/1741). Neither
reference is claimed to provide a verified fix. After a validated SDK/runtime
fix, restore the three scenarios from the pre-exception revision and require
full L1/L2 plus exact-revision review. Until then, a green suite explicitly
excludes these three scenarios and must not be reported as their resolution.
