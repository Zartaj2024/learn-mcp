# Step 04 notes

My implementation of Better Auth OAuth on top of the Step 3 notes server. The course-owned `README.md` is unchanged.

## What is here

- `src/auth.ts` runs one Better Auth instance as both the OAuth authorization server and the token issuer. It uses email/password sign-in, `organization()` for companies, `jwt({ disableSettingJwtHeader: true })` for signed access tokens, `mcp()` for the MCP OAuth flow, and `cimd()` for Client Identifier Metadata Documents. DCR remains available as a fallback for older clients.
- `disabledPaths: ["/token"]` stops the JWT plugin from exposing its own session-token endpoint. MCP clients use Better Auth's `/oauth2/token` endpoint instead.
- A `session.create.before` hook creates a personal company and admin membership before a session is issued. This covers both sign-up and later sign-ins, so the consent step always has an active company and an access token can carry the organization claim.
- `postLogin` binds the selected company to the OAuth consent reference; `customAccessTokenClaims` writes it into the access token as `org_id`.
- `src/cimd-transport.ts` fetches and validates CIMD client metadata using Workers' `fetch`, so the Worker does not need Node's CIMD transport.
- `src/index.ts` keeps the stateless Cloudflare pattern: one module-scope `createMcpHandler`/notifier, a fresh `McpServer` per request, and no caller state in Worker memory. `/mcp` is wrapped in `requireMcpAuth(...)` with the MCP resource URL, and the verified claims become the SDK's `AuthInfo`.
- `src/identity.ts` reads `sub` and `org_id` from the verified token and re-reads the membership role from D1 on every request. A removed or demoted member loses access on the next call. `owner` is accepted for compatibility, while `admin`/`owner` are the roles allowed to list company members.
- `src/server.ts` adds `list_company_members`, scoped by the verified company only. Notes stay in Workers KV under `org:<orgId>:user:<userId>:note:<noteId>`, so neither another user nor another company can read or delete them. D1 holds auth data only.
- `wrangler.jsonc` deploys this step as its own Worker, `learn-mcp-step-04`, with separate `AUTH_DB` (D1) and `NOTES` (KV) bindings. Secrets are not committed; `.dev.vars.example` contains placeholders only.

## Why CIMD here

The 2026-07-28 MCP spec prefers Client Identifier Metadata Document over Dynamic Client Registration. The authorization server advertises `client_id_metadata_document_supported: true`, and the CIMD document is committed at `step-04-auth/inspector-client.json`.

The Inspector uses the public URL:

`https://cdn.jsdelivr.net/gh/Zartaj2024/learn-mcp@main/step-04-auth/inspector-client.json`

I first tried serving the document from the Worker, but the Inspector reported `Metadata document fetch returned HTTP 404`. Publishing it from the fork's `main` branch fixed that without adding a Worker route or a secret. DCR is left enabled only as the fallback for clients that do not support CIMD.

## Run locally

```bash
cd step-04-auth
npm install
cp .dev.vars.example .dev.vars   # replace the placeholder secret locally
npm run migrations:generate      # only when Better Auth schema changes
npm run dev -- --port 8787
```

The local endpoint is `http://127.0.0.1:8787/mcp`. Do not commit the real `.dev.vars` file.

## Test

```bash
npm run typecheck
npm test
```

Both checks passed. The six tests in `test/stateless.test.ts` run in the Workers runtime with `@cloudflare/vitest-plugin` and cover:

1. unauthenticated `POST /mcp` returning 401 with an RFC 9728 `resource_metadata` challenge;
2. the five tools, including the admin-only member tool and tool annotations;
3. KV keys and listings scoped to the signed-in user, including a same-company cross-user denial and a cross-company denial;
4. admin access to `list_company_members` and a member's 403 denial;
5. per-user `resources/list`, `resources/read`, the `summarize_notes` prompt, and cross-tenant resource denial;
6. resource-change notifications through the shared notifier without sharing note data.

## Deploy

```bash
npm run deploy
```

The deployed MCP endpoint is:

`https://learn-mcp-step-04.zartajalichanna25.workers.dev/mcp`

The Worker is `learn-mcp-step-04`, the D1 database is `learn-mcp-step-04-auth`, and the KV binding is `NOTES`. Remote D1 has the 15 Better Auth tables from `migrations/0001_better_auth.sql`. The deployed version ID after the final checks was `1e6fa210-d5e5-4cf9-ad79-11dbd436c72c`.

Public checks after deployment:

- `GET /health` returned `ok`.
- Unauthenticated `POST /mcp` returned 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
- `/.well-known/oauth-protected-resource/mcp` returned the resource metadata with the MCP URL as `resource` and the Better Auth base URL as the authorization server.
- `/api/auth/.well-known/oauth-authorization-server` returned 200, with `client_id_metadata_document_supported: true`, `/oauth2/authorize`, `/oauth2/token`, JWKS, registration, introspection and revocation endpoints.
- The committed CIMD document loaded from jsDelivr.

## Inspector verification

MCP Inspector connected with OAuth and the CIMD client document. I verified:

- `tools/list` — the five notes and membership tools;
- `tools/call` — `list_company_members`, `create_note`, `list_notes`, `delete_note`;
- `resources/list` and `resources/read` — the created note as `note://<id>` with its full body;
- `prompts/get` — `summarize_notes` with a category argument.

The temporary Inspector note was deleted, and a fresh list returned no notes. Inspector was the direct evidence for resources and prompts because the chat clients below do not expose those MCP primitives to the model.

## Client verification

In claude.ai I added a custom connector named **Learn MCP Step 04**, replacing the Step 3 connector because the free plan allows one custom connector. The OAuth sign-in, consent and company selection worked. I asked for a note lifecycle and Claude created note `5490a22c-9043-4b80-ba1a-e151d7f149f5`, listed it, read the full body back, deleted it, and confirmed that a fresh `list_notes` returned no notes. As in Step 3, claude.ai exposed only tools, not `resources/list`, `resources/read` or `prompts/get`.

In ChatGPT developer mode I replaced the Step 3 custom server with **Learn MCP Step 04**, using OAuth with CIMD. ChatGPT discovered the authorization server, opened the consent page, connected the test account, and then ran the full lifecycle: create note `2048520a-3faf-4f78-8d6d-b93686fe0136`, list it, read the complete body, delete it, and confirm the list was empty. The permission prompt was approved once for the tool calls. ChatGPT also exposed only the tools, so Inspector remains the direct resource and prompt evidence.

In Claude Desktop I changed the local `mcp-remote` entry from `learn-mcp-step-03` to `learn-mcp-step-04`, restarted the app, and sent the same note lifecycle prompt after signing in. Claude Desktop loaded the Step 4 tools from the MCP server. It created note `9d901912-6292-45dc-abb5-4ec2ad85a6cc`, listed it as the only saved note, read back the full body `OAuth-protected Step 4 notes verified from Claude Desktop.`, deleted it, and confirmed that a final `list_notes` returned “You have no saved notes yet.” Claude Desktop asked for approval before each tool call, so I approved the calls one at a time. As in the other chat clients, it exposed tools but not `resources/list`, `resources/read` or `prompts/get`, so Inspector remains the direct resource/prompt evidence.

Screenshots of completed client verification are in `screenshots/claude-step04.jpg`, `screenshots/claude-desktop-step04.jpg` and `screenshots/chatgpt-step04.jpg`.

## Secrets

Only `.dev.vars.example` is committed. The real `BETTER_AUTH_SECRET` was set on the deployed Worker and is not in the repo, notes, screenshots or git history. Temporary OAuth helper/token files were deleted without reading or printing their contents.

## Versions

Dependencies are pinned in `package.json`: Better Auth packages `1.7.28`, `@modelcontextprotocol/server` `2.4.0`, `agents` `0.34.1`, Zod `4.6.7`, TypeScript `5.9.3`, Wrangler `4.124.0`, Vitest `4.1.12` and `tsx` `4.20.6`. The compatibility date remains `2026-08-22`, matching the installed Workers test runtime.
