import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src";

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
  };
  error?: { code: number; message: string };
}

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

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

async function callTool(
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<JsonRpcResponse> {
  const response = await postMcp({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });

  expect(response.status).toBe(200);
  return ssePayload(await response.text()) as unknown as JsonRpcResponse;
}

function greetingText(result: JsonRpcResponse): string {
  return result.result?.content?.find((block) => block.type === "text")?.text ?? "";
}

describe("learn-mcp-step-01 server", () => {
  it("lists the two tools", async () => {
    const payload = ssePayload(
      await (
        await postMcp({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} })
      ).text(),
    );
    const result = payload.result as { tools?: Array<{ name: string }> };

    expect(result.tools?.map((tool) => tool.name).sort()).toEqual([
      "get_time",
      "greet",
    ]);
  });

  it("keeps 20 concurrent greet calls independent", async () => {
    const names = Array.from({ length: 20 }, (_, index) => `Learner ${index}`);

    const responses = await Promise.all(
      names.map((name, index) => callTool("greet", { name }, index + 1)),
    );

    responses.forEach((response, index) => {
      expect(response.error).toBeUndefined();
      expect(response.id).toBe(index + 1);
      expect(response.result?.structuredContent?.name).toBe(names[index]);
      expect(greetingText(response)).toContain(names[index] ?? "");
    });
  }, 30_000);

  it("returns the time for a valid IANA timezone", async () => {
    const response = await callTool("get_time", { timezone: "Asia/Karachi" }, 100);
    expect(response.error).toBeUndefined();
    expect(response.result?.structuredContent?.timezone).toBe("Asia/Karachi");
    expect(greetingText(response)).toContain("Asia/Karachi");
  }, 30_000);

  it("rejects an invalid timezone with a recoverable error", async () => {
    const response = await callTool("get_time", { timezone: "Mars/Olympus" }, 101);
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(greetingText(response)).toContain("IANA");
  }, 30_000);
});
