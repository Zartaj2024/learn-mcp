# Step 01 notes

My implementation of the minimal remote MCP server. The course-owned `README.md` is unchanged.

## What is here

- `src/server.ts` builds a fresh `McpServer` with two tools: `greet` (required `name`) and `get_time` (optional IANA `timezone`). Both are read-only, validate their input with Zod, and return text plus `structuredContent`.
- `src/index.ts` creates one `createMcpHandler(createServer)` at module scope and serves it from the Worker's `fetch()`. The factory creates a new server for every request.
- `wrangler.jsonc` names the Worker `learn-mcp-step-01` and serves MCP at `/mcp`.
- `test/stateless.test.ts` runs in the Workers runtime with `@cloudflare/vitest-plugin`.

## Run locally

```bash
cd step-01-hello-world
npm install
npm run dev
```

The local endpoint is `http://localhost:8787/mcp`. Open the MCP Inspector with `npx @modelcontextprotocol/inspector`, choose **Streamable HTTP**, paste that URL, connect, then list and call the tools.

## Test

```bash
npm run typecheck
npx tsc -p test/tsconfig.json --noEmit
npm test
```

The key test sends 20 concurrent `tools/call` requests to `greet`, each with a different name, and checks that every response contains only its own name. If the `McpServer` were created once at module level instead of inside the factory, concurrent requests would share one server instance and one tool registration; a request-scoped value (a caller's name, auth context or pending elicitation state) could leak into another caller's response. Under MCP 2026-07-28 there is no session ID to separate callers, so the handler must build a fresh server per request.

## Deploy

```bash
npx wrangler login
npm run deploy
```

The public URL is `https://learn-mcp-step-01.<your-subdomain>.workers.dev/mcp`. Add it as a custom remote connector in claude.ai, Claude Desktop and ChatGPT developer mode.

No secrets are needed in this step, so `.dev.vars.example` is only a template for later steps.

## Versions

Dependencies are pinned in `package.json`. `agents@0.34.1` peer-requires `@modelcontextprotocol/server@2.4.0` and Zod 4, so keep those in sync when upgrading. `compatibility_date` is `2026-08-22` so the Workers test runtime can run the Worker locally; do not raise it above the installed `workerd` binary's supported date without upgrading the test plugin.
