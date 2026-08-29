import { z } from "zod";

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
    // Optional, not fail-closed: a model that cannot read a quantity off a
    // garbled line must be able to omit it rather than invent one to
    // satisfy the schema — a missing answer beats a fabricated one. Do not
    // tighten this back to required for symmetry with the other fields.
    quantity: z.int().positive().optional(),
    amountMinor: z.int(),
    // Two excerpts, not one (issue #3): OCR can flatten an item table into
    // columns, putting an item's name and its amount many lines apart, and a
    // single excerpt could then only cover both by quoting the whole block —
    // which MAX_EVIDENCE_LINES rightly rejects. Each part cites the line it
    // is actually printed on; a receipt that prints them together simply
    // quotes the same line twice. No adjacency is required BETWEEN the two,
    // but each excerpt is still guarded against its own line.
    nameEvidence: evidenceSchema,
    amountEvidence: evidenceSchema,
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

// --- The endpoint's own response --------------------------------------------
//
// `/api/extract`'s reply is the clients' trust boundary, not a formality: the
// mobile app does not know its server's address, it GUESSES it (api.ts —
// `http://<devServerHost>:3000`). Any other service listening on that port on
// the same network answers 200 with JSON, and `body as ExtractionResponse`
// then hands the renderer an object whose `items` is not an array, which
// throws inside render rather than failing as a request.
//
// Deliberately NOT `.strict()`, unlike ModelReplySchema above. There, an
// invented field is the hallucination the guard exists to reject. Here the
// sender is our own server, and rejecting an unknown key would mean that the
// day the endpoint adds a field, every client built before it refuses the
// whole response and shows a failure instead of rendering the parts it does
// understand. Unknown keys are stripped, known ones are checked.

const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const evidenceRefSchema = z.object({
  pageIndex: z.int().nonnegative(),
  excerpt: z.string(),
  box: frameSchema.nullable(),
});

const fieldSourceSchema = z.enum(["parser", "model"]);

/** The response counterpart of `evidenced()`: the {value, source, evidence,
 * verified} shape every reported field takes, whichever side derived it. */
function extracted<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    source: fieldSourceSchema,
    evidence: evidenceRefSchema,
    verified: z.boolean(),
  });
}

/** Every amount is an integer minor unit and every quantity a positive integer,
 * exactly as ModelReplySchema requires them one level upstream — a boundary
 * that only checked "is a number" would let a mismatched server's fractional
 * won through the guard the tighter schema applies to the model. The frame's
 * coordinates stay plain numbers: pixel geometry really is fractional. */
export const ExtractionResponseSchema = z.object({
  fields: z.object({
    merchant: extracted(z.string()).optional(),
    purchaseDate: extracted(z.string()).optional(),
    paidTotal: extracted(z.int()).optional(),
    reference: extracted(z.string()).optional(),
    currency: z.enum(["KRW", "USD"]),
  }),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.int().positive().optional(),
      amountMinor: z.int(),
      source: fieldSourceSchema,
      nameEvidence: evidenceRefSchema,
      amountEvidence: evidenceRefSchema,
      verified: z.boolean(),
    }),
  ),
  tenders: z.array(extracted(z.int())),
  arithmetic: z.object({
    itemSumMinor: z.int().nullable(),
    claimedTotalMinor: z.int().nullable(),
    reconciledTenderMinor: z.int().nullable(),
    // Three-state on purpose: `null` is "nothing to compare", not disagreement.
    agrees: z.boolean().nullable(),
  }),
  unverified: z.array(z.string()),
  disagreements: z.array(
    z.object({ path: z.string(), parserValue: z.int(), modelValue: z.int() }),
  ),
  modelReply: z.discriminatedUnion("accepted", [
    z.object({ accepted: z.literal(true) }),
    z.object({ accepted: z.literal(false), reason: z.string() }),
  ]),
});
