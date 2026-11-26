import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { handler } from "../src";

interface ToolTextContent {
  type: string;
  text?: string;
}

interface ResourceInfo {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface ResourceTemplateInfo {
  name: string;
  uriTemplate: string;
  title?: string;
  description?: string;
}

interface PromptInfo {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    content?: ToolTextContent[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    resources?: ResourceInfo[];
    resourceTemplates?: ResourceTemplateInfo[];
    prompts?: PromptInfo[];
    messages?: Array<{
      role: string;
      content: { type: string; text?: string };
    }>;
    contents?: Array<{ uri: string; mimeType?: string; text?: string }>;
  };
  error?: { code: number; message: string; data?: unknown };
}

interface ToolInfo {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

interface CreatedNote {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const kv = (env as { NOTES: KVNamespace }).NOTES;

async function clearNotes(): Promise<void> {
  const listed = await kv.list({ prefix: "note:" });
  await Promise.all(listed.keys.map((key) => kv.delete(key.name)));
}

async function postMcp(body: unknown): Promise<Response> {
  const request = new IncomingRequest("http://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function ssePayload(text: string): Record<string, unknown> {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  expect(dataLines.length).toBeGreaterThan(0);
  return JSON.parse(dataLines[dataLines.length - 1] ?? "{}") as Record<
    string,
    unknown
  >;
}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  id: number,
): Promise<JsonRpcResponse> {
  const response = await postMcp({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
  expect(response.status).toBe(200);
  return ssePayload(await response.text()) as unknown as JsonRpcResponse;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<JsonRpcResponse> {
  return rpc("tools/call", { name, arguments: args }, id);
}

async function createNote(
  title: string,
  content: string,
  category = "study",
): Promise<CreatedNote> {
  const response = await callTool(
    "create_note",
    { title, content, category },
    1,
  );
  expect(response.error).toBeUndefined();
  expect(response.result?.isError).not.toBe(true);
  return response.result?.structuredContent as unknown as CreatedNote;
}

function textOf(result: JsonRpcResponse): string {
  return (
    result.result?.content?.find((block) => block.type === "text")?.text ?? ""
  );
}

describe("learn-mcp-step-03 notes server", () => {
  beforeEach(clearNotes);
  afterEach(() => {
    vi.restoreAllMocks();
    return clearNotes();
  });

  it("lists the four notes tools with useful metadata", async () => {
    const payload = await rpc("tools/list", {}, 0);
    const tools = (payload.result as { tools?: ToolInfo[] } | undefined)
      ?.tools ?? [];

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_note",
      "delete_note",
      "get_note",
      "list_notes",
    ]);

    const create = tools.find((tool) => tool.name === "create_note");
    const remove = tools.find((tool) => tool.name === "delete_note");
    const list = tools.find((tool) => tool.name === "list_notes");

    expect(create?.description).toContain("remember");
    expect(create?.annotations?.readOnlyHint).toBe(false);
    expect(remove?.annotations?.destructiveHint).toBe(true);
    expect(list?.annotations?.readOnlyHint).toBe(true);
  });

  it("creates, lists, reads and deletes a note in Workers KV", async () => {
    const created = await callTool(
      "create_note",
      { title: "Groceries", content: "Milk and eggs", category: "personal" },
      1,
    );
    expect(created.error).toBeUndefined();
    expect(created.result?.isError).not.toBe(true);
    const note = created.result?.structuredContent as unknown as CreatedNote;
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.title).toBe("Groceries");
    expect(note.content).toBe("Milk and eggs");
    expect(note.category).toBe("personal");
    expect(textOf(created)).toContain(note.id);
    expect(textOf(created)).toContain("personal");

    const listed = await callTool("list_notes", {}, 2);
    const listResult = listed.result?.structuredContent as {
      count?: number;
      notes?: Array<{ id: string; title: string; content?: string }>;
    };
    expect(listResult.count).toBe(1);
    expect(listResult.notes?.[0]?.id).toBe(note.id);
    expect(listResult.notes?.[0]?.title).toBe("Groceries");
    expect(listResult.notes?.[0]?.content).toBeUndefined();
    expect(textOf(listed)).toContain(note.id);
    expect(textOf(listed)).toContain("Groceries");

    const read = await callTool("get_note", { id: note.id }, 3);
    expect(read.result?.structuredContent?.content).toBe("Milk and eggs");
    expect(textOf(read)).toContain("Milk and eggs");

    const deleted = await callTool("delete_note", { id: note.id }, 4);
    expect(deleted.result?.structuredContent?.deleted).toBe(true);

    const missing = await callTool("get_note", { id: note.id }, 5);
    expect(missing.result?.isError).toBe(true);
    expect(textOf(missing)).toContain("list_notes");
  });

  it("returns a recoverable error for an unknown note ID", async () => {
    const response = await callTool("get_note", { id: "does-not-exist" }, 10);
    expect(response.result?.isError).toBe(true);
    expect(textOf(response)).toContain("was not found");
    expect(textOf(response)).toContain("create_note");
  });

  it("rejects an empty title with a recoverable error", async () => {
    const response = await callTool(
      "create_note",
      { title: "   ", content: "Valid body" },
      11,
    );
    expect(response.result?.isError).toBe(true);
    expect(textOf(response)).toContain("title");
  });

  it("keeps concurrent creates independent through KV", async () => {
    const titles = Array.from({ length: 10 }, (_, index) => `Note ${index}`);
    const responses = await Promise.all(
      titles.map((title, index) =>
        callTool(
          "create_note",
          { title, content: `Body ${index}`, category: "study" },
          100 + index,
        ),
      ),
    );

    const ids = responses.map((response) => {
      expect(response.result?.isError).not.toBe(true);
      return (response.result?.structuredContent as { id?: string }).id ?? "";
    });
    expect(new Set(ids).size).toBe(titles.length);

    responses.forEach((response, index) => {
      expect(response.result?.structuredContent?.title).toBe(titles[index]);
      expect(response.result?.structuredContent?.content).toBe(`Body ${index}`);
    });

    const listed = await callTool("list_notes", {}, 200);
    expect(listed.result?.structuredContent?.count).toBe(titles.length);
  }, 30_000);

  it("lists notes as resources and reads their text through note:// URIs", async () => {
    const note = await createNote("Resource check", "Attached body");

    const listed = await rpc("resources/list", {}, 20);
    expect(listed.error).toBeUndefined();
    const resources = listed.result?.resources ?? [];
    expect(resources).toContainEqual(
      expect.objectContaining({
        uri: `note://${note.id}`,
        name: `note-${note.id}`,
        title: "Resource check",
        mimeType: "text/plain",
      }),
    );

    const templates = await rpc("resources/templates/list", {}, 21);
    expect(templates.result?.resourceTemplates).toContainEqual(
      expect.objectContaining({ uriTemplate: "note://{id}" }),
    );

    const read = await rpc("resources/read", { uri: `note://${note.id}` }, 22);
    expect(read.error).toBeUndefined();
    const content = read.result?.contents?.[0];
    expect(content?.uri).toBe(`note://${note.id}`);
    expect(content?.text).toContain("Resource check");
    expect(content?.text).toContain("study");
    expect(content?.text).toContain("Attached body");

    const missing = await rpc(
      "resources/read",
      { uri: "note://does-not-exist" },
      23,
    );
    expect(missing.error).toBeDefined();
  });

  it("offers a summarize_notes prompt with an optional category argument", async () => {
    const listed = await rpc("prompts/list", {}, 30);
    expect(listed.error).toBeUndefined();
    expect(listed.result?.prompts).toContainEqual(
      expect.objectContaining({ name: "summarize_notes" }),
    );

    const tagArgument = listed.result?.prompts
      ?.find((prompt) => prompt.name === "summarize_notes")
      ?.arguments?.find((argument) => argument.name === "tag");
    expect(tagArgument).toBeDefined();
    expect(tagArgument?.required).toBe(false);

    const fetched = await rpc(
      "prompts/get",
      { name: "summarize_notes", arguments: { tag: "study" } },
      31,
    );
    expect(fetched.error).toBeUndefined();
    const text = fetched.result?.messages?.[0]?.content?.text ?? "";
    expect(fetched.result?.messages?.[0]?.role).toBe("user");
    expect(text).toContain("study");
    expect(text).toContain("list_notes");
    expect(text).toContain("get_note");
    expect(text).toContain("note://{id}");
  });

  it("publishes resource list changes when notes are created and deleted", async () => {
    const resourcesChanged = vi.spyOn(handler.notify, "resourcesChanged");
    const resourceUpdated = vi.spyOn(handler.notify, "resourceUpdated");

    const note = await createNote("Notification check", "Body");

    expect(resourcesChanged).toHaveBeenCalledTimes(1);
    expect(resourceUpdated).toHaveBeenCalledWith(`note://${note.id}`);

    const deleted = await callTool("delete_note", { id: note.id }, 40);
    expect(deleted.result?.structuredContent?.deleted).toBe(true);
    expect(resourcesChanged).toHaveBeenCalledTimes(2);
  });
});
