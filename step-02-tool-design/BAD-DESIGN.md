# Bad tool design vs. good tool design

`src/bad-create-note.ts` is a deliberately bad version of `create_note`. It is kept only for comparison and is **not** imported by the Worker.

| Design choice | Bad version (`do`) | Good version (`create_note`) | Why it matters |
| --- | --- | --- | --- |
| Name | `do` says nothing about the action or object. | `create_note` names the verb and the noun. | The model chooses tools by name before it reads anything else. |
| Description | Empty, so the model has no signal about when to use it. | Explains when to use it and what it returns, including the note ID. | A description is a prompt for the model's tool-selection step. |
| Input schema | One optional-looking `anything` field with `z.any()`, so malformed calls pass. | Required `title` and `content` with length limits, plus a four-value `category` enum. | Tight schemas make invalid calls fail early with a message the model can act on. |
| Output | One unstructured text string; the model has to parse it. | Short text summary plus `structuredContent` matching `outputSchema`. | Structured output is reliable for both the model and a future UI. |
| Annotations | None, so the host cannot tell that the tool changes data. | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`. | Hosts use annotations for permission prompts and safe auto-approval. |
| Errors | Stringifying whatever arrived hides the problem. | Missing notes and invalid fields return clear, recoverable errors pointing to `list_notes` or `create_note`. | A useful error tells the model what to try next instead of guessing. |
| State | Implies memory inside the Worker. | Writes to the `NOTES` KV binding. | Worker memory can vanish between requests; KV is visible to every isolate. |

The good version costs a few more lines, but it makes correct calls more likely and unsafe calls easier for the host to catch.
