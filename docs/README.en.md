<p align="center"><img src="../assets/brand/icon-rounded.png" width="128" alt="Octo seahorse logo" /></p>
<h1 align="center">Octo</h1>
<p align="center">A private, API-first memory and knowledge base.</p>
<p align="center"><a href="https://octo.hexly.ai">Website</a> · <a href="https://hexly.ai/projects/octo">Hexly</a> · <a href="../README.md">简体中文</a></p>

## What it does

Octo stores private memories, tags, versions and attachments, accessed through a REST API, MCP and an admin dashboard. Cloudflare Access protects the dashboard; scoped API keys protect the API and MCP. Migration, deduplication and summarization belong to external bots, not a built-in automation service.

## Features

- Organize memories by space, with tags, versions, attachments and trash.
- Full-text and vector search; configure the embedding service through the dashboard.
- REST API and sessionless Streamable HTTP MCP for tools and bots.
- Dashboard views for editing, search, graphs, timelines, keys, audit and usage.

## Usage

Open the [dashboard](https://octo.hexly.ai) and authenticate with the configured Access identity. API keys appear only once when created or rotated; keep them in the caller's secure configuration, never URLs or browser storage.

See the [API contract](04-api.md) for REST and [MCP guide](09-mcp.md) for bot integration. Deletion moves records to trash; permanent deletion is dashboard-only.

## Development

Requires Bun 1.4, project dependencies and a local Cloudflare Worker environment. Follow the [development workflow](07-dev-workflow.md) for configuration and local database initialization; never copy production credentials into test environments.

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun run lint
bun run build
```

Vite uses 7059 and the Worker uses 37059; the local Caddy address is `https://octo.dev.hexly.ai`. Data and attachments use local D1 and R2. Local vector search uses a D1 implementation, not production Vectorize.

## Tests

```sh
bun run test:coverage
bun run test:e2e:api
bun run test:e2e:bdd
```

Browser tests require full Chromium. HTTP and browser tests use separate temporary persistence directories and ports, never remote resources. [AGENTS.md](../AGENTS.md) defines the current commands and quality requirements.

## Stack

| Technology | Role |
| --- | --- |
| TypeScript, Hono, Cloudflare Workers | API, MCP and static asset entry |
| D1, R2, Vectorize | Data, attachments and derived vector index |
| React, Vite, Basalt | Admin dashboard |
| Vitest, Playwright | Unit, HTTP and browser verification |

## Documentation

- [Design index](README.md) and [architecture](01-architecture.md).
- [Authorization and audit](05-auth-permissions-audit.md).
- [Seahorse logo, asset roles and provenance](../assets/brand/README.md).

## License

[MIT](../LICENSE)
