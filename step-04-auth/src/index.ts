import type { ServerNotifier } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";
import { env } from "cloudflare:workers";
import { createMcpHandler } from "agents/mcp/server";
import { createAuth, type AuthEnv, type AuthInstance } from "./auth";
import { resolveIdentity } from "./identity";
import { chooseCompanyPage, consentPage, htmlResponse, signInPage } from "./pages";
import { createServer } from "./server";

// The notifier bus belongs to the Worker module, while every MCP request gets
// a fresh server. This keeps subscriptions from relying on isolate memory.
const notifierSource = createMcpHandler(() => createServer(null));
const notifier: ServerNotifier = notifierSource.notify;

interface WorkerEnv extends AuthEnv {
  NOTES: KVNamespace;
}

let authInstance: AuthInstance | undefined;
function getAuth(): AuthInstance {
  authInstance ??= createAuth(env as unknown as AuthEnv);
  return authInstance;
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "");
}

function rpcForbidden(message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message },
      id: null,
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;

    if (path === "/mcp") {
      const auth = getAuth();
      const protectedHandler = requireMcpAuth(
        auth,
        async (authorizedRequest, claims) => {
          const identity = await resolveIdentity(
            env.AUTH_DB,
            claims as Record<string, unknown>,
          );
          if (identity === null) {
            return rpcForbidden(
              "Your access token has no active company membership.",
            );
          }

          const handler = createMcpHandler(() =>
            createServer(identity, notifier),
          );
          return handler.fetch(authorizedRequest, {
            authInfo: {
              token: bearerToken(authorizedRequest),
              clientId:
                typeof claims.client_id === "string" ? claims.client_id : "",
              scopes:
                typeof claims.scope === "string" ? claims.scope.split(" ") : [],
              extra: { identity },
            },
          });
        },
        { resource: env.MCP_RESOURCE_URL },
      );
      return protectedHandler(request);
    }

    if (path === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (path === "/sign-in") return htmlResponse(signInPage());
    if (path === "/consent") return htmlResponse(consentPage());
    if (path === "/choose-company") return htmlResponse(chooseCompanyPage());

    if (path.startsWith("/api/auth/") || path.startsWith("/.well-known/")) {
      return getAuth().handler(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<WorkerEnv>;
