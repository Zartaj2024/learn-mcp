import { env } from "cloudflare:workers";
import {
  type ServerNotifier,
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  listCompanyMembers,
  type CompanyMember,
} from "./identity";
import type { AuthIdentity } from "./types";

interface AppEnv {
  NOTES: KVNamespace;
  AUTH_DB: D1Database;
}

export type ResourceNotifier = Pick<
  ServerNotifier,
  "resourcesChanged" | "resourceUpdated"
>;

const NOTE_URI_TEMPLATE = "note://{id}";

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
  .max(120, "title must not be empty or longer than 120 characters")
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

const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});

const membersOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  members: z.array(memberSchema),
});

const promptArgsSchema = z.object({
  tag: categorySchema
    .describe("Optional category to focus on. Leave it out to summarize all notes.")
    .optional(),
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
  return (env as AppEnv).NOTES;
}

/** Every key starts with the company and owner from the verified token. */
function keyPrefix(identity: AuthIdentity): string {
  return `org:${identity.orgId}:user:${identity.userId}:note:`;
}

function keyFor(identity: AuthIdentity, id: string): string {
  return `${keyPrefix(identity)}${id}`;
}

function noteUri(id: string): string {
  return `note://${id}`;
}

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

function toolError(message: string) {
  return { content: textContent(message), isError: true as const };
}

async function readNote(
  identity: AuthIdentity,
  id: string,
): Promise<Note | null> {
  const raw = await kv().get(keyFor(identity, id));
  if (raw === null) return null;

  try {
    const parsed = noteSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeNote(identity: AuthIdentity, note: Note): Promise<void> {
  await kv().put(keyFor(identity, note.id), JSON.stringify(note), {
    metadata: {
      title: note.title,
      category: note.category,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  });
}

async function listNotes(identity: AuthIdentity): Promise<NoteSummary[]> {
  const prefix = keyPrefix(identity);
  const listed = await kv().list({ prefix });
  return listed.keys
    .flatMap((key): NoteSummary[] => {
      const id = key.name.slice(prefix.length);
      const parsed = noteSummarySchema.safeParse({
        id,
        ...((key.metadata ?? {}) as Record<string, unknown>),
      });
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function notFoundError(id: string): string {
  return `Note "${id}" was not found. Call list_notes to see available note IDs, or create_note to add a new note.`;
}

function parseTemplateId(uri: URL, variables: Record<string, unknown>): string | null {
  const fromVariables = Array.isArray(variables.id)
    ? variables.id[0]
    : variables.id;
  const candidate = fromVariables ?? (uri.hostname || undefined);
  const parsed = idSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function notifyResourceChange(
  notifier: ResourceNotifier | undefined,
  id: string,
): void {
  if (!notifier) return;
  notifier.resourcesChanged();
  notifier.resourceUpdated(noteUri(id));
}

function resourceBody(note: Note): string {
  return [
    `Title: ${note.title}`,
    `Category: ${note.category}`,
    `Created: ${note.createdAt}`,
    `Updated: ${note.updatedAt}`,
    "",
    note.content,
  ].join("\n");
}

function isAdmin(identity: AuthIdentity): boolean {
  return identity.role === "admin" || identity.role === "owner";
}

/**
 * Build a fresh MCP server for one request. Notes live in Workers KV, not
 * Worker memory, and each key is scoped to the signed-in user and company.
 */
export function createServer(
  identity: AuthIdentity | null,
  notifier?: ResourceNotifier,
): McpServer {
  const server = new McpServer(
    {
      name: "learn-mcp-step-04",
      version: "1.0.0",
    },
    {
      instructions:
        "Signed-in users manage their own saved notes through notes tools and note://{id} resources. Company membership and roles come from the verified OAuth token.",
    },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List my notes",
      description:
        "List all notes belonging to you in your current company, with IDs, titles, categories and timestamps. Use this when the user asks what notes exist or wants to find a note to read or delete. It does not return note bodies.",
      inputSchema: z.object({}),
      outputSchema: listOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      if (identity === null) return toolError("Sign in before calling this tool.");
      const notes = await listNotes(identity);
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
      title: "Get one of my notes",
      description:
        "Read the full body of one of your notes by its ID. Use after list_notes when the user asks to open, quote or summarize a specific note. Notes belonging to another user are not visible.",
      inputSchema: z.object({ id: idSchema }),
      outputSchema: noteSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      if (identity === null) return toolError("Sign in before calling this tool.");
      const note = await readNote(identity, id);
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
        "Create a new note owned by you in your current company. Use when the user asks to remember, save or jot down something. Returns the new note ID and its note://{id} resource URI.",
      inputSchema: z.object({
        title: titleSchema,
        content: contentSchema,
        category: categorySchema.optional(),
      }),
      outputSchema: noteSchema,
      annotations: writeAnnotations,
    },
    async ({ title, content, category }) => {
      if (identity === null) return toolError("Sign in before calling this tool.");
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

      await writeNote(identity, note);
      notifyResourceChange(notifier, note.id);

      return {
        content: textContent(
          `Created note "${note.title}" (${resolvedCategory}) with ID ${note.id}. Read it with get_note or attach ${noteUri(note.id)} as a resource.`,
        ),
        structuredContent: note,
      };
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete one of my notes",
      description:
        "Permanently delete one of your notes by ID. Use only when the user explicitly asks to remove that note. Call list_notes first if the ID is not known.",
      inputSchema: z.object({ id: idSchema }),
      outputSchema: deleteOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ id }) => {
      if (identity === null) return toolError("Sign in before calling this tool.");
      const existing = await readNote(identity, id);
      if (existing === null) return toolError(notFoundError(id));

      await kv().delete(keyFor(identity, id));
      notifyResourceChange(notifier, id);

      return {
        content: textContent(
          `Deleted note "${existing.title}" (${id}). This cannot be undone.`,
        ),
        structuredContent: { id, deleted: true as const },
      };
    },
  );

  server.registerTool(
    "list_company_members",
    {
      title: "List company members",
      description:
        "Admin only. List the people in your current company with their user ID, name, email and role. Use when an admin asks who belongs to the company. Members receive a permission error.",
      inputSchema: z.object({}),
      outputSchema: membersOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      if (identity === null) return toolError("Sign in before calling this tool.");
      if (!isAdmin(identity)) {
        return toolError(
          "403 Forbidden: listing company members requires the admin role. Ask a company admin for this information.",
        );
      }

      const members: CompanyMember[] = await listCompanyMembers(
        (env as AppEnv).AUTH_DB,
        identity.orgId,
      );
      const text =
        members.length === 0
          ? "Your company has no members."
          : [
              `Your company has ${members.length} member${members.length === 1 ? "" : "s"}:`,
              ...members.map(
                (member) =>
                  `- ${member.name} | ${member.email} | ${member.role} | ${member.userId}`,
              ),
            ].join("\n");

      return {
        content: textContent(text),
        structuredContent: { count: members.length, members },
      };
    },
  );

  server.registerResource(
    "note",
    new ResourceTemplate(NOTE_URI_TEMPLATE, {
      list: async () => ({
        resources: identity
          ? (await listNotes(identity)).map((note) => ({
              uri: noteUri(note.id),
              name: `note-${note.id}`,
              title: note.title,
              description: `${note.category} note, updated ${note.updatedAt}. Read it to see the full text.`,
              mimeType: "text/plain",
            }))
          : [],
      }),
    }),
    {
      title: "My saved note",
      description:
        "One of your saved notes at note://{id}. The host or user chooses which note to attach; resources/read returns the title, category, timestamps and body.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const id = parseTemplateId(uri, variables);
      if (id === null) {
        throw new ResourceNotFoundError(
          uri.href,
          `The note URI ${uri.href} does not contain a valid note ID.`,
        );
      }
      if (identity === null) {
        throw new ResourceNotFoundError(uri.href, "Sign in before reading notes.");
      }

      const note = await readNote(identity, id);
      if (note === null) {
        throw new ResourceNotFoundError(
          uri.href,
          `Note "${id}" was not found in your notes. Call list_notes to see available note IDs.`,
        );
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: resourceBody(note),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "summarize_notes",
    {
      title: "Summarize my notes",
      description:
        "Build a ready-made prompt that summarizes your saved notes, optionally limited to one category. The user picks this prompt; it does not change any notes.",
      argsSchema: promptArgsSchema,
    },
    ({ tag }) => ({
      description: tag
        ? `Summarize your notes in the ${tag} category.`
        : "Summarize all your notes.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Summarize my saved notes${tag ? ` in the ${tag} category` : ""}.`,
              "First call list_notes to see which notes exist. Then use get_note or attach the matching note://{id} resources to read the bodies you need.",
              tag
                ? `Focus on notes whose category is ${tag}; mention any other notes only if they are clearly relevant.`
                : "Group the summary by category and call out anything urgent.",
              "Return a short summary with the note titles you used. Do not invent details that are not in the notes.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
