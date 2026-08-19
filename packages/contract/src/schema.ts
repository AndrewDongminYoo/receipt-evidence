import { z } from "zod";
import type { Currency } from "./types.ts";

// The page excerpt every model-supplied value must carry. Constrained to a
// non-empty, non-whitespace string here as well as at guards.ts's
// verifyEvidence: every string contains the empty string, so without this
// check a schema-only defence would fail open on the plainest hallucination,
// a model returning "". Two layers because the guard is also called from
// paths this schema does not cover.
const evidenceSchema = z
  .object({
    pageIndex: z.int().nonnegative(),
    // .regex(/\S/) alone already rejects "" and whitespace-only strings;
    // .min(1) is kept so the emitted JSON Schema also carries `minLength: 1`
    // as a hint to the model, not because it adds a runtime constraint.
    excerpt: z.string().min(1).regex(/\S/),
  })
  .strict();

const CURRENCIES = ["KRW", "USD"] as const satisfies readonly Currency[];

/** Wraps a value type in the {value, evidence} shape every model-supplied
 * field takes, matching analyze.ts's ParsedField<T> but with the model's
 * own evidence shape (a page index and an excerpt) in place of an OcrEvidence
 * line. */
function evidenced<T extends z.ZodType>(value: T) {
  return z.object({ value, evidence: evidenceSchema }).strict();
}

const modelItemSchema = z
  .object({
    name: z.string().min(1),
    quantity: z.int().positive(),
    amountMinor: z.int(),
    evidence: evidenceSchema,
  })
  .strict();

/** The shape a model reply must satisfy: the receipt facts a deterministic
 * parser could not derive (analyze.ts's ParsedReceipt fields), each carrying
 * the page excerpt it was read from. Money is always an integer minor unit,
 * never a float. `additionalProperties: false` (via `.strict()`) rejects a
 * reply carrying invented fields structurally, rather than silently
 * accepting and ignoring them. */
export const ModelReplySchema = z
  .object({
    items: z.array(modelItemSchema),
    merchant: evidenced(z.string().min(1)).optional(),
    // ISO calendar date ("2026-07-02"), not free text — a project whose
    // thesis is checkable evidence should not let an unparseable date
    // string cross the schema boundary.
    purchaseDate: evidenced(z.iso.date()).optional(),
    paidTotal: evidenced(z.int()).optional(),
    currency: evidenced(z.enum(CURRENCIES)).optional(),
    reference: evidenced(z.string().min(1)).optional(),
  })
  .strict();

export type ModelReply = z.infer<typeof ModelReplySchema>;

/** The concrete shape z.toJSONSchema() always returns for an object schema —
 * narrowed here (not redefined: the properties still come from
 * ModelReplySchema at runtime) because the generic return type covers every
 * JSON Schema kind and leaves `properties` possibly undefined. */
type ObjectJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  additionalProperties: false;
};

/** The JSON Schema handed to the model API, derived FROM ModelReplySchema
 * rather than hand-written beside it — one zod definition produces the
 * runtime validator, the TypeScript type, and this, so they cannot drift
 * apart. */
export function modelJsonSchema(): ObjectJsonSchema {
  return z.toJSONSchema(ModelReplySchema) as ObjectJsonSchema;
}
