import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

/**
 * Teaching example: a deliberately badly designed version of create_note.
 *
 * It is not imported by index.ts and is never deployed. Compare it with the
 * create_note tool in server.ts and with BAD-DESIGN.md.
 */
export function registerBadCreateNote(server: McpServer): void {
  server.registerTool(
    "do",
    {
      title: "Do",
      description: "",
      inputSchema: z.object({ anything: z.any() }),
    },
    async ({ anything }) => ({
      content: [{ type: "text" as const, text: String(anything) }],
    }),
  );
}
