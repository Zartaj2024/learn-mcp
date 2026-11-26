import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(
  (env as unknown as { AUTH_DB: D1Database }).AUTH_DB,
  (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] })
    .TEST_MIGRATIONS,
);
