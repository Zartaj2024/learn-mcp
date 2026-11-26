# Step 03 notes

My implementation of resources and prompts on top of the Step 2 notes server. The course-owned `README.md` is unchanged.

## What is here

- `src/server.ts` keeps the four notes tools from step 2 and adds the other two MCP primitives:
  - a `note://{id}` resource template, so every note can be listed with `resources/list` and read with `resources/read`;
  - a `summarize_notes` prompt with one optional `tag` argument.
- `src/index.ts` keeps the stateless Cloudflare pattern: one module-scope `createMcpHandler`, a fresh `McpServer` for every request, and no caller state in Worker memory. The module-scope notifier is passed into each fresh server so create and delete can publish `resources/list_changed` to the handler's subscription bus.
- Notes still live in Workers KV under `note:<id>`, and KV metadata powers both `list_notes` and `resources/list`.
- `wrangler.jsonc` deploys this step as its own Worker, `learn-mcp-step-03`, with its own `NOTES` KV binding. No secrets are needed, so `.dev.vars.example` is only a template.

## Tool, resource or prompt?

| Feature | Primitive | Why |
| --- | --- | --- |
| `create_note` | Tool | It has a side effect and the model decides when the user's request calls it. |
| `delete_note` | Tool | It is destructive and must be model-called with an explicit user request. |
| `list_notes` | Tool | The model needs to discover IDs during a conversation; a short summary keeps its context small. |
| `get_note` | Tool | The model chooses which note body to fetch after seeing the list. |
| Each note at `note://<id>` | Resource | The note is read-only data with a stable address. The host or user decides to attach it, rather than leaving the choice to the model. |
| `summarize_notes` | Prompt | It is a repeatable message template that a person picks deliberately. It does not change data. |

The same note is deliberately reachable as both a tool (`get_note`) and a resource (`note://<id>`). That makes the control difference easy to see: the model calls the tool; the user or host attaches the resource.

## Why prompts are small here

MCP prompts remain in the 2026-07-28 spec, but they are rarely used because most clients do not surface them prominently and the model has to be told to fetch context anyway. A skill served over MCP (step 10) is now the usual way to ship reusable know-how: the user does not have to pick it from a slash menu, the model loads it when the task needs it, and it works more consistently across clients. This step keeps one prompt because it teaches the primitive; later steps use skills for real procedures.

## List-changed notifications

`create_note` and `delete_note` call `handler.notify.resourcesChanged()`, and `create_note` also calls `handler.notify.resourceUpdated(noteUri(id))`. The tests verify those calls with spies.

This notification only reaches clients that already have an open `subscriptions/listen` stream on this same handler. Under `createMcpHandler`, each ordinary request gets a fresh `McpServer`, so a client that simply calls `tools/call` and then re-lists resources will not receive a push from a different request. That is fine for this step: KV is the source of truth, and the next `resources/list` or `resources/read` returns current data. A multi-process production deployment would need a shared bus instead of the handler's in-process bus.

## Run locally

```bash
cd step-03-resources-and-prompts
npm install
npm run dev -- --port 8788
```

The local endpoint is `http://127.0.0.1:8788/mcp`. I used MCP Inspector in CLI mode against that endpoint and checked:

- `tools/list` — all four notes tools
- `resources/list` — the created note as `note://<id>` with title, category description and `text/plain`
- `resources/templates/list` — the `note://{id}` template
- `resources/read` — the note body with its metadata
- `prompts/list` — `summarize_notes` with an optional `tag` argument
- `prompts/get` with `tag=study` — user message that tells the model to call `list_notes`, use `get_note` or attach `note://{id}` resources, and stay within the notes

The temporary Inspector note was deleted through `delete_note` after the check.

## Test

```bash
npm run typecheck
npm test
```

All checks passed. The eight tests in `test/stateless.test.ts` run in the Workers runtime with `@cloudflare/vitest-plugin`. They cover:

1. `tools/list` metadata and annotations
2. the full create → list → get → delete lifecycle in Workers KV
3. a recoverable error for an unknown note ID
4. a recoverable error for an empty title
5. ten concurrent creates, checking that every response keeps its own title and body
6. `resources/list`, `resources/templates/list`, `resources/read` and a missing-resource error
7. `prompts/list` and `prompts/get` with the optional `tag` argument
8. resource list-change and resource-updated notifications through the handler notifier

## Deploy

```bash
npm run deploy
```

The deployed MCP endpoint is:

`https://learn-mcp-step-03.zartajalichanna25.workers.dev/mcp`

The Worker is `learn-mcp-step-03` and its `NOTES` binding uses a separate KV namespace, `NOTES_STEP_03`. The deployed version ID was `7996086e-c10f-437f-81d7-723469511084`.

I verified the public URL with MCP Inspector CLI in Streamable HTTP mode:

- `tools/list` — all four notes tools with their titles, schemas and annotations
- `resources/list` — the created note as `note://<id>` with its title, category description and `text/plain` MIME type
- `resources/templates/list` — the `note://{id}` template
- `resources/read` — the note's title, category, timestamps and full body
- `prompts/list` and `prompts/get` with `tag=study` — the `summarize_notes` user message with the category filter
- `create_note`, `list_notes`, `get_note` and `delete_note` — the full lifecycle through the public Worker, with structured content

A normal browser `GET /mcp` returns `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`. That is expected: `/mcp` is a Streamable HTTP MCP endpoint, so it must be used by an MCP client such as Inspector or a chat client, not opened as an ordinary web page. The temporary public note was deleted through `delete_note`, and a final `resources/list` returned an empty list.

## Client verification

In claude.ai I added the public URL as a custom connector named **Learn MCP Step 03**, replacing the Step 2 connector because the free plan allows one custom connector. I asked:

> Using my Learn MCP Step 03 notes tools, save a note titled "Step 3 verification" with content "MCP resources and prompts are working on the public Worker." and category "study". Then list my notes and read the full body back to me.

Claude chose `create_note`, then `list_notes` and `get_note`. It reported note ID `47ff267e-aa1f-4755-9f89-9cb43b0688a6` with URI `note://47ff267e-aa1f-4755-9f89-9cb43b0688a6`, and the list and read calls returned the title, category and complete body. I then deleted that temporary note through the deployed `delete_note` tool.

claude.ai did not expose MCP resources or prompts to the model: Claude said it had no resource list/read tool and no way to invoke `prompts/get`, so it produced an ordinary summary from the tool results instead. This is a client limitation, not a server error. The public MCP Inspector checks above are the direct evidence that `resources/list`, `resources/read`, `prompts/list` and `prompts/get` work on the deployed server.

In Claude Desktop I registered the same public endpoint as a local MCP server named `learn-mcp-step-03`, using `npx mcp-remote` as the stdio bridge because this Desktop build did not offer a direct custom-connector URL field. No token or secret was needed. I asked:

> Using my learn-mcp-step-03 MCP tools, create a note titled "Claude Desktop check" with content "Verified from Claude Desktop." and category study. Then list notes and read the full body back to me.

Claude Desktop loaded the four tools, created note `6ca1fd56-35eb-49e7-afd5-09840cca2e24`, listed it as the only saved note, and read back the complete body `Verified from Claude Desktop.` It also noticed a second copy of the same tools under the web connector name **Learn MCP Step 03**, but did not use it. When I asked it to run `summarize_notes` with `tag=study` and to read `note://6ca1fd56-35eb-49e7-afd5-09840cca2e24` as a resource, Claude Desktop said it could only call MCP tools and had no `prompts/get`, `resources/list` or `resources/read` capability. That matches the claude.ai limitation and again leaves MCP Inspector as the direct resource/prompt evidence. The temporary Desktop note was deleted through `delete_note`.

In ChatGPT developer mode I replaced the Step 2 custom MCP server with **Learn MCP Step 03**, using the same public URL and no authentication. I asked:

> Using Learn MCP Step 03, create a note titled "ChatGPT step 3 check" with content "Verified from ChatGPT developer mode." and category work. Then list notes and read the full body back to me.

ChatGPT chose the notes tools and reported that it created note `f457b2f9-4bf2-4d46-94e6-22dd5ddd98a6`, listed it with category `work`, and retrieved the complete body `Verified from ChatGPT developer mode.` It then tried the prompt:

> Use the summarize_notes prompt from Learn MCP Step 03 with tag=work and follow its instructions. If the prompt is not directly available, say so clearly.

ChatGPT said that `summarize_notes` was not directly available. It listed only `create_note`, `list_notes`, `get_note` and `delete_note`, and correctly refused to pretend that its own summary came from the MCP prompt. All temporary client notes were deleted through `delete_note`, and the final `resources/list` was empty.

Screenshots of the client verification are in `screenshots/claude-step03.jpg`, `screenshots/claude-desktop-step03.jpg`, `screenshots/claude-desktop-step03-prompt.jpg` and `screenshots/chatgpt-step03.jpg`.

## Versions

Dependencies are pinned in `package.json`. As in steps 1 and 2, `agents@0.34.1` peer-requires `@modelcontextprotocol/server@2.4.0` and Zod 4, so keep those in sync when upgrading. `compatibility_date` is `2026-08-22`, matching the installed Workers test runtime.
