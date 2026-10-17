# 99 — 待决问题

> 返回 [文档目录](README.md)

已决（2026-10-17）：本地域名 `octo.dev.hexly.ai`、生产域名 `octo.hexly.ai`；Cloudflare Access team `nocoo`、AUD 已给出（见 05 §2）；不做速率限制；不用 Durable Objects；MCP 放在阶段 3。

| # | 问题 | 影响 | 当前默认 |
|---|---|---|---|
| 1 | **向量模型与 profile：** 知识库 bot 用哪个 embedding 模型、多少维？是否需要同时保留多个 profile？ | 03 §2：Vectorize 索引名和维度在创建时就固定 | 先建一个活跃 profile；切换模型时新建索引并回填 |
| 2 | **Dashboard 查询向量的来源：** 浏览器里搜索时由谁生成查询向量？选项：a) Worker 调用 Workers AI（要求和知识库 bot 用同一个模型）；b) 调用外部 embedding API（需要 secret）；c) dashboard 只做 FTS，向量搜索交给 bot | 06 `/search` 与 API 是否完全对等 | 阶段 2 前决定；在此之前 dashboard 只提供 FTS 和「以某条 memory 的向量查相似」 |
| 3 | **R2 CDN 域名：** 域名是什么？鉴权方式？选项：Worker 签发短时 HMAC URL，CDN 侧校验（WAF token auth 或一个很薄的 Worker）；或 CDN 域名也放在 Access 后面 | 附件下载路径 | 先由 Worker 鉴权后流式返回；接口里返回的 URL 由服务端生成，以后切到 CDN 时客户端不用改 |
| 4 | **审计日志保留期：** 永久保留，还是 N 天后归档到 R2？ | D1 容量 | 永久保留，dashboard 监控体积 |
| 5 | **本地端口：** 是否认可 7059 / 17059 / 27059 / 37059？同意后会改 Caddyfile 和 workflow 副本，并写 nmem 记录 | 07 §3 | 待确认 |
| 6 | **类型白名单：** v1 的 `type` 取值是否就是 fact / preference / decision / procedure / event / log / note？是否允许 bot 自定义类型？ | 02 校验 | 服务端白名单，可以在 dashboard 扩展 |
| 7 | **单条正文和附件的上限：** 正文 1 MB、附件 50 MB 是否合适？ | 04 §2 | 按这个值 |
| 8 | **Nowledge Mem 迁移：** 知识库 bot 迁移时需要保留原 id 和时间戳吗？（需要的话，提供 `created_at` 覆盖字段和 `external_id`，只允许 admin 角色使用） | 02 / 04 | 建议提供 `external_id`（在 space 内唯一）和 admin 专用的时间覆盖 |
