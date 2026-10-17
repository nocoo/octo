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
