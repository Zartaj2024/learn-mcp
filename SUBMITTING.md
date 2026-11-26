# Submitting Your Work

This bootcamp is also an assignment. You do all your work in **your own fork** of this repository, and you submit each finished step through the submission form.

> ⛔ **Do not open pull requests to this repository.** Pull requests to `panaversity/learn-mcp` are not how you submit, and they will be closed without review. Your work stays in your fork.

## 1. Fork the repository

1. Sign in to GitHub and open https://github.com/panaversity/learn-mcp.
2. Click **Fork**, then choose your own account as the owner.
3. Keep the repository name `learn-mcp`, and leave **Copy the `main` branch only** checked.

Your fork is public, like the original. Never commit secrets (see [Keep secrets out of git](#7-keep-secrets-out-of-git)).

## 2. Clone your fork

Clone **your fork**, not the original:

```bash
git clone https://github.com/<your-username>/learn-mcp.git
cd learn-mcp
git remote add upstream https://github.com/panaversity/learn-mcp.git
git remote -v   # origin = your fork, upstream = the bootcamp repo
```

Then open Claude Desktop, go to the **Code** tab, and choose your cloned `learn-mcp` folder (the repo root) as the folder to work in.

## 3. Keep your fork in sync

New steps and fixes are added to the bootcamp repo over time. Pull them into your fork before starting each step.

**On GitHub:** open your fork and click **Sync fork → Update branch**.

**Or from the terminal:**

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

To avoid merge conflicts when you sync:

- **Don't edit the bootcamp's own files**: `README.md`, `AGENTS.md`, `SUBMITTING.md`, `.claude/skills/`, and the `README.md` inside each step folder.
- Put your own notes in a `NOTES.md` inside the step folder instead.

## 4. Do the work in each step folder

- Work through the steps in order, starting with [`step-01-hello-world/`](step-01-hello-world/).
- Follow the **Build it with Claude Code** section in each step's README, working in the **Code** tab of Claude Desktop.
- All your code for a step goes inside that step's folder. Each step starts from a copy of your previous step's code.
- Commit often, with clear messages:

```bash
git add step-01-hello-world
git commit -m "step-01: add greet and get_time tools"
git push origin main
```

## 5. Deploy to your own accounts

Every student deploys to **their own** accounts:

- **Cloudflare:** your own Workers deployment (`*.workers.dev` or your own domain). Each step is its own Worker named `learn-mcp-step-NN`, so deploying step 2 doesn't replace step 1
- **Neon:** your own project, from step 5, with one branch per step (`step-05`, `step-06` …). Each step's first prompt creates its branch, so a later step's migrations never break an earlier step that is still being graded
- **Claude and ChatGPT:** connect your deployed server as a custom connector in claude.ai or Claude Desktop, and in ChatGPT developer mode

Keep your server running until your step has been graded.

## 6. Tag each finished step

When a step is finished, deployed and tested, tag the commit and push the tag:

```bash
git tag step-01-done
git push origin step-01-done
```

Use the tag names `step-01-done`, `step-02-done` … `step-21-done`. The grader reviews the code at your tag, so make sure everything for the step is committed before you tag.

Tags are final: never move or delete a tag you have submitted, because the grader may already be reviewing it. If you need to fix something after tagging, commit the fix, add a new tag with a version suffix and submit that tag in the form:

```bash
git tag step-01-done-v2
git push origin step-01-done-v2
```

## 7. Keep secrets out of git

- Store secrets with `wrangler secret put`, and keep local values in `.dev.vars`. The repo's `.gitignore` already keeps `.dev.vars`, `node_modules/` and `.wrangler/` out of git, so don't remove those lines.
- Never commit `.dev.vars`, API keys, database connection strings or tokens. Commit a `.dev.vars.example` with placeholder values instead.
- If you commit a secret by accident, **rotate it right away** (create a new key or password). Deleting the commit isn't enough, because your fork is public.

## 8. Submit the step

Submit each step through the form:

**📝 Submission form: `TODO: FORM LINK (the bootcamp team will add it here)`**

> Until the link is added, keep each finished step tagged and pushed. You can submit every finished step once the form opens.

For each step, the form asks for:

| Field | Example |
| --- | --- |
| Your fork's URL | `https://github.com/<your-username>/learn-mcp` |
| Step tag | `step-01-done` |
| Live MCP server URL | `https://learn-mcp-step-01.<your-subdomain>.workers.dev/mcp` |
| Screenshot: Claude | The step's tool or widget working in claude.ai or Claude Desktop |
| Screenshot: ChatGPT | The same thing working in ChatGPT |

Each step's README ends with a **Submission checklist** listing exactly what that step needs.

## 9. How each step is graded

Each step is graded out of 10. A step passes at 7, and the grader reviews the code at your `step-NN-done` tag and the live server URL you submit.

| Criterion | Points | What the grader checks |
| --- | --- | --- |
| Works in Claude | 2 | The step's tools (and widgets, from step 9) work in claude.ai or Claude Desktop, as your screenshot shows |
| Works in ChatGPT | 2 | The same in ChatGPT developer mode. For an extension a client doesn't support yet, your NOTES.md records the support status and the fallback works |
| Builds what the step asks | 2 | Everything in the step's **What you will build** and **Submission checklist** is there, inside the remote MCP server |
| Design and code quality | 1 | Clear tool names, descriptions and schemas, correct annotations, recoverable errors, no state kept in the Worker's memory, readable code |
| Security and tenant isolation | 2 | No secrets in git, inputs validated, every data access scoped to the signed-in user and their company (from step 4), and from step 7 the cross-tenant suite passes and the step's tenant-isolation checklist item is met |
| NOTES.md | 1 | A short explanation, in your own words, of what you built, the choices you made and how to run it |

**Automatic fail for the step:** any way for one company to reach another company's data, a committed secret that wasn't rotated, a server that can't be reached at the submitted URL, or code copied from another student.

**Capstone (step 21)** is graded out of 20: the 10 points above, plus up to 10 more: every Core row of the requirements table (3), extras that are justified and kept simple, with no technology added without a client need (2), the evaluation results (2), CLIENT.md with the client's acceptance tests (1), the architecture and handover notes (1) and the demo video (1).

## Getting help

- Re-read the step's README and ask Claude (in the Code tab) to explain whatever is unclear.
- Ask your instructor or classmates through the bootcamp's usual help channel. Don't use pull requests for questions.
