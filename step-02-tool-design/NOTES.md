# Step 02 notes

My implementation of the notes toolset with good tool design. The course-owned `README.md` is unchanged.

## What is here

- `src/server.ts` registers four notes tools: `list_notes`, `get_note`, `create_note` and `delete_note`. Each has a title, a model-facing description, a tight Zod input schema, an output schema, correct annotations, and a short text summary alongside `structuredContent`.
- `list_notes` and `get_note` are read-only; `create_note` writes; `delete_note` is marked destructive. Missing notes and invalid fields return recoverable errors that point the model to the next useful tool.
- Notes live in the `NOTES` Workers KV binding under `note:<id>` keys. KV metadata powers `list_notes`, so the listing returns IDs, titles, categories and timestamps without reading every note body.
- `src/index.ts` keeps the stateless pattern from step 1: one `createMcpHandler(createServer)` at module scope, with a fresh `McpServer` per request. Nothing about a caller is kept in Worker memory.
- `src/bad-create-note.ts` is a deliberately bad `create_note` kept only for comparison. It is not imported or deployed. `BAD-DESIGN.md` explains why the good version is more likely to be called correctly and is safer for hosts to approve.
- `wrangler.jsonc` names the Worker `learn-mcp-step-02` and binds the `NOTES` KV namespace. No secrets are needed, so `.dev.vars.example` is only a template.

## Run locally

```bash
cd step-02-tool-design
npm install
npm run dev
```

The local endpoint is `http://127.0.0.1:8788/mcp`. I used MCP Inspector with **Streamable HTTP** and checked `tools/list`, `create_note`, `list_notes` and `delete_note` against that local endpoint before deploying.

## Test

```bash
npm run typecheck
npx tsc -p test/tsconfig.json --noEmit
npm test
```

All checks passed. The five tests in `test/stateless.test.ts` run in the Workers runtime with `@cloudflare/vitest-plugin`. They cover:

1. `tools/list` metadata and annotations
2. the full create → list → get → delete lifecycle in Workers KV
3. a recoverable error for an unknown note ID
4. a recoverable error for an empty title
5. ten concurrent creates, checking that every response keeps its own title and body and that KV contains ten notes

I also improved the `list_notes` text summary after Claude pointed out that the first version returned only a count. It now includes each note's ID, title, category and update time, while keeping `structuredContent` small and machine-readable.

## Deploy

```bash
npm run deploy
```

The deployed MCP endpoint is:

`https://learn-mcp-step-02.zartajalichanna25.workers.dev/mcp`

I verified the public URL with MCP Inspector: `tools/list` returns all four tools, and calls to `create_note`, `list_notes`, `get_note` and `delete_note` succeed with structured content. Temporary verification notes were deleted through the deployed tool, and the final deployed version includes the improved `list_notes` output.

## Client verification

I added the public URL as a custom connector named **Learn MCP Step 02** in claude.ai. Claude discovered `get_note` and `list_notes` as read-only tools and `create_note` and `delete_note` as write/delete tools.

In Claude I asked:

> Using my notes MCP tools, save a note titled "Step 2 check" with content "Claude selected create_note and wrote to Workers KV." and category "study". Then list my notes to confirm it was saved.

Claude chose `create_note`, then `list_notes`, then `get_note` to verify the saved body. After I improved and redeployed `list_notes`, I asked Claude to list the notes again; it chose `list_notes` and confirmed the title `Step 2 check`, category `study` and ID. claude.ai's free plan allows one custom connector, so this connector replaced the step 1 connector rather than adding a second one.

In ChatGPT I added the same URL as a custom MCP server named **Learn MCP Step 02**, with no authentication, and removed the step 1 server. I asked:

> Using the Learn MCP Step 02 notes tools, save a note titled "Step 2 ChatGPT check" with content "ChatGPT selected create_note and wrote to Workers KV." and category "study". Then list my notes and confirm the saved title and category.

ChatGPT chose the notes tools and reported that it created the note and used `list_notes` to verify two notes, including the title `Step 2 ChatGPT check` with category `study`.

Screenshots of the model choosing the correct notes tools are in `screenshots/claude-notes.jpg` and `screenshots/chatgpt-notes.jpg`.

## Versions

Dependencies are pinned in `package.json`. As in step 1, `agents@0.34.1` peer-requires `@modelcontextprotocol/server@2.4.0` and Zod 4, so keep those in sync when upgrading. `compatibility_date` is `2026-08-22`, matching the installed Workers test runtime.
