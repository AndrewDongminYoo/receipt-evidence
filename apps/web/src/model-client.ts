// The OpenAI call, isolated behind ModelClient so extract.ts's pipeline
// never imports `openai` and tests never touch the network (Task 14 brief).
//
// Model identifier: gpt-5.6-sol, recorded from OpenAI's own docs, not from
// memory — see docs/notes/model-identifier.md for the date and source URL.
//
// Structured-outputs constraint (also recorded in that file): OpenAI's
// `strict: true` json_schema mode requires every property in `required`,
// with an optional field expressed as a nullable union rather than omitted
// from `required`. schema.ts's ModelReplySchema instead uses zod's
// `.optional()` on purpose (a field the model cannot support should be
// absent, not null) and that file is shared/reviewed, so it is not this
// task's to reshape. `toStrictSchema` below reshapes a COPY of the emitted
// JSON Schema for the outbound request only; `stripNulls` undoes the
// resulting present-as-null fields on the way back in, before the reply
// ever reaches ModelReplySchema.safeParse.
import OpenAI from "openai";
import { modelJsonSchema } from "@receipt-evidence/contract/schema";
import type { Page } from "./extract.ts";

const MODEL = "gpt-5.6-sol";

/** One method, so a test can substitute a fake and never call OpenAI. */
export interface ModelClient {
  complete(input: { pages: readonly Page[] }): Promise<unknown>;
}

// Recurses into every nested object/array node — modelItemSchema's own
// `quantity` is an optional property one level inside `items`, and strict
// mode's "every property in `required`" rule applies at every level, not
// only the top one. stripNulls below has to recurse in the same shape, or a
// model that omits a nested optional (an item with no quantity) comes back
// with `quantity: null`, which ModelReplySchema's `.optional()` rejects
// (absent, not null) and the whole reply is dropped.
export function toStrictSchema(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const schema = node as { type?: string; items?: unknown; properties?: Record<string, unknown>; required?: string[] };
  if (schema.type === "array" && schema.items !== undefined) {
    return { ...schema, items: toStrictSchema(schema.items) };
  }
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      const recursed = toStrictSchema(value);
      properties[key] = required.has(key) ? recursed : { anyOf: [recursed, { type: "null" }] };
    }
    return { ...schema, properties, required: Object.keys(schema.properties) };
  }
  return schema;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value !== "object" || value === null) return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== null) cleaned[key] = stripNulls(entry);
  }
  return cleaned;
}

/** The model output item shape this client actually reads: a message whose
 * first content part is the JSON text. Read via narrow runtime checks
 * rather than the SDK's full response-item union, since this path is
 * exercised only against the live API, never by a test. */
function extractOutputText(response: unknown): string {
  const output = (response as { output?: unknown }).output;
  const items = Array.isArray(output) ? output : [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { type, content } = item as { type?: unknown; content?: unknown };
    if (type !== "message" || !Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const { type: partType, text } = part as { type?: unknown; text?: unknown };
      if (partType === "output_text" && typeof text === "string") return text;
    }
  }
  throw new Error("model response carried no output_text");
}

const SYSTEM_PROMPT =
  "Read this receipt and report only what a deterministic parser could not: every line item, plus any of merchant, purchaseDate, paidTotal, or reference the parser left blank. Every value must quote the exact page excerpt (verbatim substring) it was read from, with the page index it came from. Money is an integer minor unit, never a float. Omit a field you cannot support with a real excerpt rather than guessing.";

/** Builds the request's `input` array. Exported and pure for the same reason
 * `toStrictSchema` is: a fake `ModelClient` substitutes this whole file, so
 * it cannot see what the real client sends — only a test over the builder
 * can, and no test here touches the network.
 *
 * A page's image travels only when the caller attached one. The app attaches
 * a JPEG solely for a page below the scanner's OCR floor (spec step 2), so
 * an above-floor page must go as text alone: the image staying on the device
 * is the point of the floor, not an optimisation. */
export function buildInput(pages: readonly Page[]): OpenAI.Responses.ResponseInput {
  const content: OpenAI.Responses.ResponseInputMessageContentList = [];
  for (const [pageIndex, page] of pages.entries()) {
    content.push({ type: "input_text", text: `Page ${pageIndex}:\n${page.text}` });
    if (page.imageDataUrl !== undefined) {
      // `image_url` takes "a fully qualified URL or base64 encoded image in a
      // data URL" (ResponseInputImage, openai@7.5.0 responses.d.ts:3289-3293),
      // which is why Page carries the whole data URL rather than bare base64.
      // `detail` is a required property on that interface, not an optional one.
      content.push({ type: "input_image", detail: "auto", image_url: page.imageDataUrl });
    }
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content },
  ];
}

export function createOpenAIClient(apiKey: string): ModelClient {
  const client = new OpenAI({ apiKey });
  return {
    async complete({ pages }) {
      const response = await client.responses.create({
        model: MODEL,
        input: buildInput(pages),
        text: {
          format: {
            type: "json_schema",
            name: "receipt_extraction",
            strict: true,
            schema: toStrictSchema(modelJsonSchema()) as Record<string, unknown>,
          },
        },
      });

      return stripNulls(JSON.parse(extractOutputText(response)));
    },
  };
}
