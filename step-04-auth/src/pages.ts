const shell = (title: string, body: string, script: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.6rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input { box-sizing: border-box; width: 100%; padding: .65rem; font: inherit; }
  button { margin-top: 1rem; padding: .65rem 1rem; font: inherit; cursor: pointer; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; }
  .card { border: 1px solid #8886; border-radius: .5rem; padding: 1rem; margin-top: 1rem; }
  code { overflow-wrap: anywhere; }
  #error { color: #c62828; min-height: 1.5rem; }
</style>
</head>
<body>
${body}
<script>
${script}
</script>
</body>
</html>`;

const signedQuery = `
const oauthQuery = location.search.replace(/^\\?/, "");
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || response.statusText);
  return data;
}
function resume(data) {
  if (data?.url) location.href = data.url;
  else location.reload();
}
function show(error) {
  document.getElementById("error").textContent = error instanceof Error ? error.message : String(error);
}
`;

export const signInPage = (): string =>
  shell(
    "Sign in - Stockroom MCP",
    `<h1>Sign in to Stockroom</h1>
<p>Your notes and company membership are protected by OAuth. Sign in or create an account to continue.</p>
<form id="form">
  <label for="name">Name (new accounts only)</label>
  <input id="name" name="name" autocomplete="name" />
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autocomplete="email" />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required minlength="8" autocomplete="current-password" />
  <div class="row">
    <button type="submit" data-mode="sign-in">Sign in</button>
    <button type="button" id="signup">Create account</button>
  </div>
</form>
<p id="error" role="alert"></p>`,
    `${signedQuery}
document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await post("/api/auth/sign-in/email", {
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
      oauth_query: oauthQuery,
    });
    resume(data);
  } catch (error) { show(error); }
});
document.getElementById("signup").addEventListener("click", async () => {
  try {
    const data = await post("/api/auth/sign-up/email", {
      name: document.getElementById("name").value,
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
      oauth_query: oauthQuery,
    });
    resume(data);
  } catch (error) { show(error); }
});`,
  );

export const consentPage = (): string =>
  shell(
    "Authorize - Stockroom MCP",
    `<h1>Authorize the AI client</h1>
<p>The client asks to access your saved notes and company membership.</p>
<div class="card">
  <p>Client ID: <code id="client"></code></p>
  <p>Response goes to: <code id="redirect"></code></p>
</div>
<p id="error" role="alert"></p>
<div class="row">
  <button id="allow">Allow</button>
  <button id="deny">Deny</button>
</div>`,
    `${signedQuery}
const params = new URLSearchParams(location.search);
document.getElementById("client").textContent = params.get("client_id") || "(not supplied)";
document.getElementById("redirect").textContent = params.get("redirect_uri") || "(not supplied)";
async function consent(accept) {
  try {
    const data = await post("/api/auth/oauth2/consent", { accept, oauth_query: oauthQuery });
    resume(data);
  } catch (error) { show(error); }
}
document.getElementById("allow").addEventListener("click", () => consent(true));
document.getElementById("deny").addEventListener("click", () => consent(false));`,
  );

export const chooseCompanyPage = (): string =>
  shell(
    "Choose company - Stockroom MCP",
    `<h1>Choose a company</h1>
<p id="error" role="alert"></p>
<div id="companies" class="card">Loading companies...</div>`,
    `${signedQuery}
async function init() {
  const response = await fetch("/api/auth/organization/list", { credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || response.statusText);
  const organizations = Array.isArray(data) ? data : (data.organizations || []);
  const container = document.getElementById("companies");
  container.textContent = "";
  for (const organization of organizations) {
    const button = document.createElement("button");
    button.textContent = organization.name || organization.id;
    button.addEventListener("click", async () => {
      try {
        await post("/api/auth/organization/set-active", { organizationId: organization.id });
        const continued = await post("/api/auth/oauth2/continue", { postLogin: true, oauth_query: oauthQuery });
        resume(continued);
      } catch (error) { show(error); }
    });
    container.appendChild(button);
  }
  if (organizations.length === 0) container.textContent = "No company membership found.";
}
init().catch(show);`,
  );

export function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
