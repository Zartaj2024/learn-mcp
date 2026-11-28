import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt, organization } from "better-auth/plugins";
import { fetchClientMetadataResource } from "./cimd-transport";
import { ensurePersonalCompany, firstOrganizationId } from "./identity";
import { ORG_CLAIM } from "./types";

export interface AuthEnv {
  AUTH_DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  MCP_RESOURCE_URL: string;
}

/**
 * One Better Auth instance for both the OAuth authorization server and the
 * protected MCP resource. D1 holds only auth data; notes stay in KV.
 */
export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    // The JWT plugin's own /token endpoint would mint session JWTs with the
    // same key as OAuth access tokens. MCP clients use /oauth2/token instead.
    disabledPaths: ["/token"],
    databaseHooks: {
      session: {
        create: {
          // The user row already exists here. Creating the company in this
          // hook covers both sign-up and later sign-ins, and guarantees that
          // a session always has an active company before a token is issued.
          before: async (session) => {
            const user = await env.AUTH_DB.prepare(
              'SELECT "id", "name" FROM "user" WHERE "id" = ? LIMIT 1',
            )
              .bind(session.userId)
              .first<{ id: string; name: string }>();
            if (user === null) {
              throw new APIError("BAD_REQUEST", {
                message: "Your account was not found.",
              });
            }

            await ensurePersonalCompany(env.AUTH_DB, user);
            const orgId = await firstOrganizationId(env.AUTH_DB, user.id);
            if (orgId === undefined) {
              throw new APIError("BAD_REQUEST", {
                message: "Your account has no company membership.",
              });
            }
            return {
              data: { ...session, activeOrganizationId: orgId },
            };
          },
        },
      },
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      organization(),
      mcp({
        resource: env.MCP_RESOURCE_URL,
        loginPage: "/sign-in",
        consentPage: "/consent",
        // CIMD is preferred. DCR remains available as the fallback the
        // 2026-07-28 spec still allows for older clients.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        scopes: ["openid", "profile", "email", "offline_access"],
        refreshTokenReuseInterval: 0,
        // Bind the consent choice into the access token. The role is still
        // checked against D1 on every MCP request.
        postLogin: {
          page: "/choose-company",
          shouldRedirect: () => false,
          consentReferenceId: ({ session }) => {
            const orgId = session.activeOrganizationId;
            return typeof orgId === "string" ? orgId : undefined;
          },
        },
        customAccessTokenClaims: ({ referenceId }) =>
          referenceId ? { [ORG_CLAIM]: referenceId } : {},
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
