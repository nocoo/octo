<p align="center"><img src="assets/brand/icon-rounded.png" width="128" alt="Octo 海马 Logo" /></p>
<h1 align="center">Octo</h1>
<p align="center">以 API 为主的私人记忆与知识库。</p>
<p align="center"><a href="https://octo.hexly.ai">站点</a> · <a href="https://hexly.ai/projects/octo">Hexly</a> · <a href="docs/README.en.md">English</a></p>

## 这是什么

Octo 保存私人记忆、标签、版本与附件，通过 REST API、MCP 和管理工作台访问。工作台由 Cloudflare Access 保护；API 与 MCP 使用有作用域的接口密钥。迁移、去重和摘要由外部 bot 完成，不是内置自动化服务。

## 功能

- 按空间组织记忆，维护标签、版本、附件与回收站。
- 全文与向量搜索；嵌入服务通过工作台配置。
- REST API 与无会话 Streamable HTTP MCP，供工具和 bot 接入。
- 工作台提供记忆编辑、搜索、图谱、时间线、密钥、审计和用量查看。

## 使用

打开[工作台](https://octo.hexly.ai)，通过已配置的 Access 身份认证。接口密钥仅在创建或轮换时显示一次，应保存在调用方的安全配置中，不能放入 URL 或浏览器存储。

REST 接入见 [API 文档](docs/04-api.md)，MCP 接入见 [MCP 文档](docs/09-mcp.md)。删除先进入回收站；永久删除仅在工作台操作。

## 开发

需要 Bun 1.4、项目依赖和本地 Cloudflare Worker 环境。配置及本地数据库初始化按[开发流程](docs/07-dev-workflow.md)执行；不复制生产凭据到测试环境。

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun run lint
bun run build
```

Vite 使用 7059，Worker 使用 37059；本地 Caddy 地址为 `https://octo.dev.hexly.ai`。数据库为本地 D1，附件为本地 R2；本地向量搜索使用 D1 实现，不访问生产 Vectorize。

## 测试

```sh
bun run test:coverage
bun run test:e2e:api
bun run test:e2e:bdd
```

浏览器流程需要完整 Chromium。API 与浏览器测试使用独立临时持久化目录和端口，不使用远程资源。可用命令和质量要求以 [AGENTS.md](AGENTS.md) 为准。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript、Hono、Cloudflare Workers | API、MCP 与静态资源入口 |
| D1、R2、Vectorize | 数据、附件与派生向量索引 |
| React、Vite、Basalt | 管理工作台 |
| Vitest、Playwright | 单元、HTTP 与浏览器验证 |

## 文档

- [设计文档索引](docs/README.md)与[架构](docs/01-architecture.md)。
- [权限与审计](docs/05-auth-permissions-audit.md)。
- [海马 Logo、文件用途与来源](assets/brand/README.md)。

## 许可证

[MIT](LICENSE)
