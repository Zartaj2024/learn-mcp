import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createMcpHandler } from "agents/mcp/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import type { AuthIdentity } from "../src/types";
import { createServer, type ResourceNotifier } from "../src/server";

interface ToolTextContent {
  type: string;
  text?: string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    content?: ToolTextContent[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    resources?: Array<{ uri: string; title?: string }>;
    resourceTemplates?: Array<{ uriTemplate: string }>;
    prompts?: Array<{ name: string; arguments?: Array<{ name: string; required?: boolean }> }>;
    messages?: Array<{
      role: string;
      content: { type: string; text?: string };
    }>;
    contents?: Array<{ uri: string; text?: string }>;
    tools?: Array<{
      name: string;
      description?: string;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
      };
    }>;
  };
  error?: { code: number; message: string };
}

interface CreatedNote {
  id: string;
  title: string;
  content: string;
  category: string;
}

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const testEnv = env as unknown as { NOTES: KVNamespace; AUTH_DB: D1Database };

const admin: AuthIdentity = {
  userId: "user-admin",
  orgId: "org-acme",
  role: "admin",
};
const member: AuthIdentity = {
  userId: "user-member",
  orgId: "org-acme",
  role: "member",
};
const otherOrgUser: AuthIdentity = {
  userId: "user-other",
  orgId: "org-other",
  role: "admin",
};

function ssePayload(text: string): Record<string, unknown> {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  expect(dataLines.length).toBeGreaterThan(0);
  return JSON.parse(dataLines.at(-1) ?? "{}") as Record<string, unknown>;
}

async function rpc(
  identity: AuthIdentity | null,
  method: string,
  params: Record<string, unknown>,
  id: number,
  notifier?: ResourceNotifier,
): Promise<JsonRpcResponse> {
  const handler = createMcpHandler(() => createServer(identity, notifier));
  const request = new IncomingRequest("http://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const response = await handler.fetch(request, {
    authInfo: {
      token: "test-token",
      clientId: "test-client",
      scopes: [],
      extra: { identity },
    },
  });
  expect(response.status).toBe(200);
  return ssePayload(await response.text()) as unknown as JsonRpcResponse;
}

async function callTool(
  identity: AuthIdentity | null,
  name: string,
  args: Record<string, unknown>,
  id: number,
  notifier?: ResourceNotifier,
): Promise<JsonRpcResponse> {
  return rpc(identity, "tools/call", { name, arguments: args }, id, notifier);
}

async function createNote(
  identity: AuthIdentity,
  title: string,
  content: string,
  category = "study",
  notifier?: ResourceNotifier,
): Promise<CreatedNote> {
  const response = await callTool(
    identity,
    "create_note",
    { title, content, category },
    1,
    notifier,
  );
  expect(response.result?.isError).not.toBe(true);
  return response.result?.structuredContent as unknown as CreatedNote;
}

function textOf(result: JsonRpcResponse): string {
  return result.result?.content?.find((block) => block.type === "text")?.text ?? "";
}

async function clearNotes(): Promise<void> {
  const listed = await testEnv.NOTES.list({ prefix: "org:" });
  await Promise.all(listed.keys.map((key) => testEnv.NOTES.delete(key.name)));
}

async function seedMemberships(): Promise<void> {
  const db = testEnv.AUTH_DB;
  const now = new Date().toISOString();

  for (const [orgId, name] of [
    ["org-acme", "Acme"],
    ["org-other", "Other Co"],
  ]) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO "organization" ("id", "name", "slug", "createdAt")
         VALUES (?, ?, ?, ?)`,
      )
      .bind(orgId, name, `slug-${orgId}`, now)
      .run();
  }

  for (const [userId, name, email] of [
    ["user-admin", "Ada Admin", "ada@example.com"],
    ["user-member", "Mia Member", "mia@example.com"],
    ["user-other", "Otto Other", "otto@example.com"],
  ]) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO "user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(userId, name, email, 1, now, now)
      .run();
  }

  for (const [userId, orgId, role] of [
    ["user-admin", "org-acme", "admin"],
    ["user-member", "org-acme", "member"],
    ["user-other", "org-other", "admin"],
  ]) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO "member"
         ("id", "organizationId", "userId", "role", "createdAt")
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(`membership-${orgId}-${userId}`, orgId, userId, role, now)
      .run();
  }
}

describe("learn-mcp-step-04 auth and tenant isolation", () => {
  beforeEach(async () => {
    await clearNotes();
    await seedMemberships();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearNotes();
  });

  it("requires an OAuth token on /mcp and advertises resource metadata", async () => {
    const request = new IncomingRequest("http://example.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "resource_metadata",
    );
  });

  it("lists five tools, including the admin-only member tool", async () => {
    const payload = await rpc(admin, "tools/list", {}, 0);
    const tools = payload.result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_note",
      "delete_note",
      "get_note",
      "list_company_members",
      "list_notes",
    ]);

    expect(
      tools.find((tool) => tool.name === "list_company_members")
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "delete_note")?.annotations
        ?.destructiveHint,
    ).toBe(true);
  });

  it("scopes KV keys and note listings to the signed-in user", async () => {
    const note = await createNote(member, "Mia's note", "Private body");
    expect(
      await testEnv.NOTES.get(
        `org:${member.orgId}:user:${member.userId}:note:${note.id}`,
      ),
    ).not.toBeNull();

    const ownList = await callTool(member, "list_notes", {}, 2);
    expect(ownList.result?.structuredContent?.count).toBe(1);

    const otherList = await callTool(otherOrgUser, "list_notes", {}, 3);
    expect(otherList.result?.structuredContent?.count).toBe(0);

    const sameCompanyOtherUser: AuthIdentity = {
      userId: "user-admin",
      orgId: "org-acme",
      role: "admin",
    };
    const adminList = await callTool(sameCompanyOtherUser, "list_notes", {}, 4);
    expect(adminList.result?.structuredContent?.count).toBe(0);

    const stolen = await callTool(
      sameCompanyOtherUser,
      "get_note",
      { id: note.id },
      5,
    );
    expect(stolen.result?.isError).toBe(true);
    expect(textOf(stolen)).toContain("was not found");
  });

  it("allows admins but not members to list company members", async () => {
    const denied = await callTool(member, "list_company_members", {}, 10);
    expect(denied.result?.isError).toBe(true);
    expect(textOf(denied)).toContain("403 Forbidden");

    const allowed = await callTool(admin, "list_company_members", {}, 11);
    expect(allowed.result?.isError).not.toBe(true);
    const result = allowed.result?.structuredContent as {
      count?: number;
      members?: Array<{ userId: string; role: string }>;
    };
    expect(result.count).toBe(2);
    expect(result.members?.map((item) => item.userId).sort()).toEqual([
      "user-admin",
      "user-member",
    ]);
  });

  it("isolates resources and keeps the summarize_notes prompt", async () => {
    const note = await createNote(member, "Resource check", "Attached body");

    const listed = await rpc(member, "resources/list", {}, 20);
    expect(listed.result?.resources).toContainEqual(
      expect.objectContaining({ uri: `note://${note.id}` }),
    );

    const otherList = await rpc(otherOrgUser, "resources/list", {}, 21);
    expect(otherList.result?.resources ?? []).toHaveLength(0);

    const read = await rpc(
      member,
      "resources/read",
      { uri: `note://${note.id}` },
      22,
    );
    expect(read.result?.contents?.[0]?.text).toContain("Attached body");

    const forbidden = await rpc(
      otherOrgUser,
      "resources/read",
      { uri: `note://${note.id}` },
      23,
    );
    expect(forbidden.error).toBeDefined();

    const prompt = await rpc(
      member,
      "prompts/get",
      { name: "summarize_notes", arguments: { tag: "study" } },
      24,
    );
    expect(prompt.result?.messages?.[0]?.content?.text).toContain("study");
  });

  it("notifies through the shared notifier without sharing notes", async () => {
    const resourcesChanged = vi.fn();
    const resourceUpdated = vi.fn();
    const notifier = { resourcesChanged, resourceUpdated };

    const note = await createNote(admin, "Notification check", "Body", "study", notifier);
    expect(resourcesChanged).toHaveBeenCalledTimes(1);
    expect(resourceUpdated).toHaveBeenCalledWith(`note://${note.id}`);

    const deleted = await callTool(
      admin,
      "delete_note",
      { id: note.id },
      40,
      notifier,
    );
    expect(deleted.result?.structuredContent?.deleted).toBe(true);
    expect(resourcesChanged).toHaveBeenCalledTimes(2);
  });
});
