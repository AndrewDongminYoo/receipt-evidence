# OpenAI model identifier

Recorded per Task 14 Step 1 — the identifier below was read from OpenAI's own
documentation, not from memory, and the extraction endpoint must use it verbatim.

- **Model identifier:** `gpt-5.6-sol`
- **Date read:** 2026-08-19
- **Source URL:** <https://developers.openai.com/api/docs/models> (canonical docs URL
  `https://platform.openai.com/docs/models` 301-redirects here)

## What the source says

- `gpt-5.6-sol` is OpenAI's current flagship general-purpose model: "If you're not sure
  where to start, use GPT-5.6 Sol, our flagship model for complex reasoning and coding."
- It is called through the Responses API (`client.responses.create`), supports text and
  image input with text output, and supports structured outputs (JSON Schema) and tool
  use — the capabilities this project's extraction endpoint needs.
- Sibling variants exist at the same doc URL (`gpt-5.6-terra`, cost/intelligence
  balanced; `gpt-5.6-luna`, cost-optimized) but `gpt-5.6-sol` is the one the docs name
  as the default starting point, so it is the one this project uses.

## Structured outputs constraint found while implementing Task 14

OpenAI's structured-outputs guide
(<https://developers.openai.com/api/docs/guides/structured-outputs>, read 2026-08-19)
states that `strict: true` JSON Schema mode requires **every** property to be listed in
`required`, with optional fields expressed as nullable unions (`type: [T, "null"]`)
rather than omitted from `required`. `packages/contract/src/schema.ts`'s
`ModelReplySchema` instead uses zod's `.optional()` for `merchant`, `purchaseDate`,
`paidTotal`, and `reference` — a field the model cannot support is meant to be *absent*,
not present-as-null, and that shape is unchanged by this task (see the Task 14 report
for why: the file is shared and reviewed, so a shape change goes back to the plan owner,
not into this diff). `apps/web/src/model-client.ts` works around the mismatch at the
request boundary instead of touching `schema.ts` — see that file's header comment.
