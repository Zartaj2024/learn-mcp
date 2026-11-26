import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";

// The handler lives for the lifetime of the Worker isolate. The server factory
// runs for each request, so no caller state survives between requests.
const handler = createMcpHandler(createServer);

export default {
  fetch(request, env, ctx) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler;
