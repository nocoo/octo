# octo 设计文档

octo 是部署在 Zheng 个人 Cloudflare 付费账户上的私人记忆 / 知识库 SaaS，用来替代 Nowledge Mem。它只存数据、以 API 为主：迁移、打标签、去重和摘要由知识库 bot 在外部完成。

- 生产：`https://octo.hexly.ai`（Worker custom domain；`/api/v1/*` 用 API key，dashboard 用 Cloudflare Access）
- 本地开发：`https://octo.dev.hexly.ai`（Caddy + mkcert）
- 需求来源：知识库 bot 提交的 requirements v1（2026-10-17），要点见 [01](01-architecture.md) §1

| # | 文档 | 权威范围 |
|---|---|---|
| 01 | [架构与技术栈](01-architecture.md) | 拓扑、技术栈、目录、绑定、范围之外 |
| 02 | [数据模型](02-data-model.md) | D1 表、版本、标签、回收站、变更流、R2 键 |
| 03 | [搜索](03-search.md) | FTS5 trigram、Vectorize、过滤、混合融合 |
| 04 | [REST API](04-api.md) | 路径、信封、错误码、幂等、分页 |
| 05 | [认证、权限与审计](05-auth-permissions-audit.md) | API key、角色、范围、Access、审计、用量 |
| 06 | [Dashboard](06-dashboard.md) | Basalt 3.1.0、页面、可视化、动效 |
| 07 | [开发流程与质量门](07-dev-workflow.md) | TDD、6DQ、覆盖率、Caddy、CI、部署 |
| 08 | [路线图](08-roadmap.md) | 阶段、里程碑、并行拆分 |
| 09 | [MCP 服务](09-mcp.md) | 无状态 Streamable HTTP、工具 schema、错误映射、bot 接入 |
| 99 | [待决问题](99-open-questions.md) | 尚需 Zheng 决定的事项 |

Operational contract: [Vector convergence, embedding economy and smoke](vector-convergence.md).

冲突时的优先级：质量看 07，表结构看 02，HTTP 看 04，权限看 05，页面看 06。01 是方向性摘要。

本目录只写设计。实现前，先按 [07](07-dev-workflow.md) 写失败测试。

M7 owns the admin HTTP contract, audit/usage, encrypted embedding settings,
backfill and the production Vectorize synchronizer. M6 owns the atomic HTTP/D1
write boundary; the dashboard consumes [04 §6](04-api.md#6-admin-api只给-dashboard).
The synchronizer's durable queue and non-transactional recovery protocol are
specified in [02](02-data-model.md#m7-derived-index-ownership-and-recovery).
