import { mkdir, writeFile } from "node:fs/promises";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/auth";

const dialect = {
  createAdapter: () => new SqliteAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
  createQueryCompiler: () => new SqliteQueryCompiler(),
};

const auth = createAuth({
  AUTH_DB: { type: "sqlite", dialect } as unknown as D1Database,
  BETTER_AUTH_SECRET: "local-generation-only-not-a-real-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
  MCP_RESOURCE_URL: "http://localhost:8787/mcp",
});

const migration = await getMigrations(auth.options, { throwOnUnsafe: false });

if (migration.unsafeChanges.length > 0) {
  throw new Error(migration.unsafeChanges.join("\n"));
}

await mkdir("migrations", { recursive: true });
await writeFile(
  "migrations/0001_better_auth.sql",
  `${await migration.compileMigrations()}\n`,
);

console.log(
  `Generated ${migration.toBeCreated.length} tables and ${migration.toBeAdded.length} column changes.`,
);
