# Phase 2a — MCP server
Read: docs/08-roadmap.md (MCP), docs/05 (auth), docs/04 (v1 capabilities).
Dirs: apps/web/src/server/mcp/**, tests/api/mcp*.
Deliver: /mcp stateless Streamable HTTP endpoint using the official MCP TypeScript SDK (verify current stateless support; NO Durable Objects, no session storage), auth = same Bearer API key + authorize(); tools: search, get_memory, batch_get, create_memory, update_memory, delete_memory, list_changes, list_tags, list_spaces — each delegating to existing v1 services. Contract tests via real HTTP (initialize, tools/list, tools/call happy + denied paths).
