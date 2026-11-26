import type { ServerNotifier } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";

// The handler owns the module-scope subscription bus. Each request still gets a
// fresh McpServer, but all of them publish list changes through this notifier.
let notifier: ServerNotifier | undefined;
export const handler = createMcpHandler(() => createServer(notifier));
notifier = handler.notify;

export default {
  fetch(request, env, ctx) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler;
