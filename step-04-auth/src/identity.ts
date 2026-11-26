import { ORG_CLAIM, type AuthIdentity } from "./types";

export interface CompanyMember {
  userId: string;
  name: string;
  email: string;
  role: string;
}

/**
 * The first sign-in creates a personal company. Creating the organization and
 * its admin membership here means the session hook can always set an active
 * company before the OAuth consent reference is chosen.
 */
export async function ensurePersonalCompany(
  db: D1Database,
  user: { id: string; name: string },
): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM organization WHERE slug = ? LIMIT 1")
    .bind(`personal-${user.id}`)
    .first<{ id: string }>();
  if (existing !== null) return;

  const now = new Date().toISOString();
  const orgId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO "organization" ("id", "name", "slug", "createdAt")
         VALUES (?, ?, ?, ?)`,
      )
      .bind(orgId, `${user.name || "My"}'s company`, `personal-${user.id}`, now),
    db
      .prepare(
        `INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), orgId, user.id, "admin", now),
  ]);
}

/** Set the active company on a new session from the user's membership. */
export async function firstOrganizationId(
  db: D1Database,
  userId: string,
): Promise<string | undefined> {
  const row = await db
    .prepare(
      `SELECT "organizationId" FROM "member"
       WHERE "userId" = ? ORDER BY "createdAt" ASC LIMIT 1`,
    )
    .bind(userId)
    .first<{ organizationId: string }>();
  return row?.organizationId;
}

/**
 * Resolve the caller from the verified access token. The company comes only
 * from the token claim chosen at connect time; the role is re-read from D1 on
 * every request so demotion or removal takes effect immediately.
 */
export async function resolveIdentity(
  db: D1Database,
  claims: Record<string, unknown>,
): Promise<AuthIdentity | null> {
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const orgId = typeof claims[ORG_CLAIM] === "string" ? claims[ORG_CLAIM] : null;
  if (userId === null || orgId === null) return null;

  const member = await db
    .prepare(
      `SELECT "role" FROM "member"
       WHERE "organizationId" = ? AND "userId" = ? LIMIT 1`,
    )
    .bind(orgId, userId)
    .first<{ role: string }>();
  if (member === null || !["admin", "member", "owner"].includes(member.role)) {
    return null;
  }

  return { userId, orgId, role: member.role };
}

export async function listCompanyMembers(
  db: D1Database,
  orgId: string,
): Promise<CompanyMember[]> {
  const result = await db
    .prepare(
      `SELECT m."userId" AS "userId", u."name" AS "name", u."email" AS "email", m."role" AS "role"
       FROM "member" AS m
       JOIN "user" AS u ON u."id" = m."userId"
       WHERE m."organizationId" = ?
       ORDER BY m."createdAt" ASC`,
    )
    .bind(orgId)
    .all<CompanyMember>();
  return result.results;
}

export function identityFromExtra(extra: unknown): AuthIdentity | null {
  if (typeof extra !== "object" || extra === null) return null;
  const identity = (extra as { identity?: unknown }).identity;
  if (typeof identity !== "object" || identity === null) return null;
  const candidate = identity as Record<string, unknown>;
  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.orgId !== "string" ||
    typeof candidate.role !== "string"
  ) {
    return null;
  }
  return {
    userId: candidate.userId,
    orgId: candidate.orgId,
    role: candidate.role,
  };
}
