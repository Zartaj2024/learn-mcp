import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const nameSchema = z
  .string()
  .trim()
  .min(1, "name must not be empty")
  .max(100, "name must be at most 100 characters")
  .describe("The name of the person to greet.");

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .min(1, "timezone must not be empty")
  .max(64, "timezone must be at most 64 characters")
  .refine(isIanaTimeZone, {
    message: "timezone must be a valid IANA name, for example Asia/Karachi or UTC",
  })
  .describe(
    "Optional IANA time zone name (for example Asia/Karachi, Europe/London or UTC). Defaults to UTC.",
  );

const greetOutputSchema = z.object({
  name: z.string(),
  greeting: z.string(),
});

const timeOutputSchema = z.object({
  timezone: z.string(),
  iso: z.string(),
  formatted: z.string(),
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Build a fresh MCP server for one request.
 *
 * The server and its tools are deliberately created per request: under MCP
 * 2026-07-28 there is no protocol session, so nothing about a caller may live
 * in Worker memory between requests.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "learn-mcp-step-01",
    version: "1.0.0",
  });

  server.registerTool(
    "greet",
    {
      title: "Greet a person",
      description:
        "Return a friendly greeting for the given name. Use this when the user asks to be greeted or wants to test the MCP connection.",
      inputSchema: z.object({ name: nameSchema }),
      outputSchema: greetOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ name }) => {
      const greeting = `Hello, ${name}! Nice to meet you from a remote MCP server on Cloudflare Workers.`;
      return {
        content: [{ type: "text" as const, text: greeting }],
        structuredContent: { name, greeting },
      };
    },
  );

  server.registerTool(
    "get_time",
    {
      title: "Get the current time",
      description:
        "Return the current date and time. Pass an IANA time zone such as Asia/Karachi to see local time; omit it to use UTC.",
      inputSchema: z.object({ timezone: timezoneSchema.optional() }),
      outputSchema: timeOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ timezone }) => {
      const resolvedTimezone = timezone ?? "UTC";
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: resolvedTimezone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);

      return {
        content: [
          {
            type: "text" as const,
            text: `Current time in ${resolvedTimezone}: ${formatted}`,
          },
        ],
        structuredContent: {
          timezone: resolvedTimezone,
          iso: now.toISOString(),
          formatted,
        },
      };
    },
  );

  return server;
}
