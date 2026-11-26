import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

interface Env {
  NOTES: KVNamespace;
}

const NOTE_PREFIX = "note:";

const idSchema = z
  .string()
  .trim()
  .min(1, "note id must not be empty")
  .max(64, "note id must be at most 64 characters")
  .describe("The ID returned by list_notes or create_note.");

const titleSchema = z
  .string()
  .trim()
  .min(1, "title must not be empty")
  .max(120, "title must be at most 120 characters")
  .describe("A short, descriptive title for the note.");

const contentSchema = z
  .string()
  .trim()
  .min(1, "content must not be empty")
  .max(4_000, "content must be at most 4000 characters")
  .describe("The full text of the note.");

const categorySchema = z
  .enum(["personal", "work", "study", "idea"])
  .describe("Optional category; defaults to personal.");

type Category = z.infer<typeof categorySchema>;

const noteSummarySchema = z.object({
  id: idSchema,
  title: titleSchema,
  category: categorySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const noteSchema = noteSummarySchema.extend({ content: contentSchema });

type NoteSummary = z.infer<typeof noteSummarySchema>;
type Note = z.infer<typeof noteSchema>;

const listOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  notes: z.array(noteSummarySchema),
});

const deleteOutputSchema = z.object({
  id: idSchema,
  deleted: z.literal(true),
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function kv(): KVNamespace {
  return (env as Env).NOTES;
}

function keyFor(id: string): string {
  return `${NOTE_PREFIX}${id}`;
}

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

function toolError(message: string) {
  return { content: textContent(message), isError: true as const };
}

async function readNote(id: string): Promise<Note | null> {
  const raw = await kv().get(keyFor(id));
  if (raw === null) return null;

  try {
    const parsed = noteSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeNote(note: Note): Promise<void> {
  await kv().put(keyFor(note.id), JSON.stringify(note), {
    metadata: {
      title: note.title,
      category: note.category,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  });
}

function notFoundError(id: string): string {
  return `Note "${id}" was not found. Call list_notes to see available note IDs, or create_note to add a new note.`;
}

/**
 * Build a fresh MCP server for one request.
 *
 * The notes themselves live in Workers KV. Worker memory is not used because
 * Cloudflare can run many isolates and discard them between requests; KV is
 * visible to every copy of the Worker.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "learn-mcp-step-02",
    version: "1.0.0",
  });

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List all saved notes with their IDs, titles, categories and timestamps. Use this when the user asks what notes exist or wants to find a note to read or delete. It does not return note bodies.",
      inputSchema: z.object({}),
      outputSchema: listOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      const listed = await kv().list({ prefix: NOTE_PREFIX });
      const notes = listed.keys
        .flatMap((key): NoteSummary[] => {
          const id = key.name.slice(NOTE_PREFIX.length);
          const parsed = noteSummarySchema.safeParse({
            id,
            ...((key.metadata ?? {}) as Record<string, unknown>),
          });
          return parsed.success ? [parsed.data] : [];
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      const text =
        notes.length === 0
          ? "You have no saved notes yet. Use create_note to add one."
          : [
              `You have ${notes.length} saved note${notes.length === 1 ? "" : "s"}:`,
              ...notes.map(
                (note) =>
                  `- ${note.id} | ${note.title} | ${note.category} | updated ${note.updatedAt}`,
              ),
              "Use get_note with an ID to read the full body.",
            ].join("\n");

      return {
        content: textContent(text),
        structuredContent: { count: notes.length, notes },
      };
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get a note",
      description:
        "Read the full body of one note by its ID. Use after list_notes when the user asks to open, quote or summarize a specific note.",
      inputSchema: z.object({ id: idSchema }),
      outputSchema: noteSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      const note = await readNote(id);
      if (note === null) return toolError(notFoundError(id));

      return {
        content: textContent(
          `Note "${note.title}" (${id}, ${note.category}):\n${note.content}`,
        ),
        structuredContent: note,
      };
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Create a new note with a title and body. Use when the user asks to remember, save or jot down something. Returns the new note ID for later get_note or delete_note calls.",
      inputSchema: z.object({
        title: titleSchema,
        content: contentSchema,
        category: categorySchema.optional(),
      }),
      outputSchema: noteSchema,
      annotations: writeAnnotations,
    },
    async ({ title, content, category }) => {
      const now = new Date().toISOString();
      const resolvedCategory: Category = category ?? "personal";
      const note: Note = {
        id: crypto.randomUUID(),
        title,
        content,
        category: resolvedCategory,
        createdAt: now,
        updatedAt: now,
      };

      await writeNote(note);

      return {
        content: textContent(
          `Created note "${note.title}" (${resolvedCategory}) with ID ${note.id}. Use get_note with that ID to read it back.`,
        ),
        structuredContent: note,
      };
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete a note",
      description:
        "Permanently delete one note by ID. Use only when the user explicitly asks to remove that note. Call list_notes first if the ID is not known.",
      inputSchema: z.object({ id: idSchema }),
      outputSchema: deleteOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ id }) => {
      const existing = await readNote(id);
      if (existing === null) return toolError(notFoundError(id));

      await kv().delete(keyFor(id));

      return {
        content: textContent(
          `Deleted note "${existing.title}" (${id}). This cannot be undone.`,
        ),
        structuredContent: { id, deleted: true as const },
      };
    },
  );

  return server;
}
