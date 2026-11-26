import { classifyHost } from "@better-auth/core/utils/host";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

/**
 * Workers-compatible CIMD resource fetch.
 *
 * Cloudflare Workers cannot use the Node transport shipped by
 * `@better-auth/cimd/node`. This transport keeps the checks a Worker can make:
 * HTTPS only, GET/HEAD only, no redirects, a public-syntax host, and a bounded
 * response size. DNS pinning remains a documented platform limitation.
 */
export const fetchClientMetadataResource: ClientMetadataResourceFetch = async (
  input,
  init,
) => {
  const request = new Request(input, init);
  const url = new URL(request.url);

  if (url.protocol !== "https:") {
    throw new TypeError("CIMD metadata URLs must use HTTPS");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new TypeError("CIMD metadata fetches support only GET and HEAD");
  }
  if (url.username || url.password) {
    throw new TypeError("CIMD metadata URLs must not contain credentials");
  }

  const host = classifyHost(url.host);
  if (host.kind !== "public") {
    throw new TypeError(`CIMD metadata host is not public: ${url.hostname}`);
  }

  const response = await fetch(request, {
    redirect: "manual",
    signal: request.signal,
  });

  if (response.status >= 300 && response.status < 400) {
    throw new TypeError("CIMD metadata redirects are not allowed");
  }

  const location = response.headers.get("location");
  if (location !== null) {
    throw new TypeError("CIMD metadata redirects are not allowed");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 64_000) {
    throw new TypeError("CIMD metadata document is too large");
  }

  return response;
};
