import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ExtractionResponseSchema, ModelReplySchema, modelJsonSchema } from "../src/schema.ts";
import type { ExtractionResponse } from "../src/response.ts";

test("the schema requires evidence on every value", () => {
  const withoutEvidence = { items: [{ name: "커피", quantity: 1, amountMinor: 4500 }] };

  assert.equal(ModelReplySchema.safeParse(withoutEvidence).success, false);
});

test("the schema accepts a fully evidenced reply", () => {
  const reply = {
    items: [
      {
        name: "커피",
        quantity: 1,
        amountMinor: 4500,
        nameEvidence: { pageIndex: 0, excerpt: "커피 4,500" },
        amountEvidence: { pageIndex: 0, excerpt: "커피 4,500" },
      },
    ],
    merchant: { value: "GS25", evidence: { pageIndex: 0, excerpt: "GS25" } },
  };

  assert.equal(ModelReplySchema.safeParse(reply).success, true);
});

test("an item needs BOTH its name's and its amount's evidence, not one shared excerpt", () => {
  // The pre-#3 shape: one `evidence` for the whole item. On a column-flattened
  // receipt that forced the model to quote the whole block, and `.strict()` is
  // what keeps the old shape from silently satisfying the new schema.
  const oldShape = {
    items: [
      { name: "커피", amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
    ],
  };
  const nameOnly = {
    items: [
      { name: "커피", amountMinor: 4500, nameEvidence: { pageIndex: 0, excerpt: "커피 4,500" } },
    ],
  };

  assert.equal(ModelReplySchema.safeParse(oldShape).success, false);
  assert.equal(ModelReplySchema.safeParse(nameOnly).success, false);
});

test("the JSON schema handed to the model matches the zod definition", () => {
  const jsonSchema = modelJsonSchema();

  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.items, "items must be present in the JSON schema");
  assert.equal(jsonSchema.additionalProperties, false);
});

test("the schema rejects an empty or whitespace-only excerpt", () => {
  const itemWith = (excerpt: string) => ({
    items: [
      {
        name: "커피",
        quantity: 1,
        amountMinor: 4500,
        nameEvidence: { pageIndex: 0, excerpt },
        amountEvidence: { pageIndex: 0, excerpt: "커피 4,500" },
      },
    ],
  });

  assert.equal(ModelReplySchema.safeParse(itemWith("")).success, false);
  assert.equal(ModelReplySchema.safeParse(itemWith("   ")).success, false);
});

test("a reply carrying an invented field is rejected, not silently stripped", () => {
  const reply = {
    items: [
      {
        name: "커피",
        quantity: 1,
        amountMinor: 4500,
        nameEvidence: { pageIndex: 0, excerpt: "커피 4,500" },
        amountEvidence: { pageIndex: 0, excerpt: "커피 4,500" },
      },
    ],
    confidence: 0.91,
  };

  assert.equal(ModelReplySchema.safeParse(reply).success, false);
});

// --- ExtractionResponseSchema ------------------------------------------------

function aResponse(): unknown {
  const evidence = { pageIndex: 0, excerpt: "커피 4,500", box: { x: 1, y: 2, width: 3, height: 4 } };
  return {
    fields: {
      merchant: { value: "GS25", source: "parser", evidence: { ...evidence, box: null }, verified: true },
      currency: "KRW",
    },
    items: [
      {
        name: "커피",
        quantity: 1,
        amountMinor: 4500,
        source: "model",
        nameEvidence: evidence,
        amountEvidence: evidence,
        verified: true,
      },
    ],
    tenders: [],
    arithmetic: { itemSumMinor: 4500, claimedTotalMinor: 4500, reconciledTenderMinor: null, agrees: true },
    unverified: [],
    disagreements: [],
    modelReply: { accepted: true },
  };
}

test("the response schema accepts what the endpoint emits", () => {
  assert.equal(ExtractionResponseSchema.safeParse(aResponse()).success, true);
});

// The assignments below are the real assertion and they are checked by
// `pnpm typecheck`, not by node: the schema and the hand-written interface must
// describe the same shape in BOTH directions. One direction alone is vacuous in
// the loose one, which is how a schema quietly stops describing the response.
test("the response schema and ExtractionResponse describe the same shape", () => {
  const parsed = ExtractionResponseSchema.parse(aResponse());
  const asInterface: ExtractionResponse = parsed;
  const asSchema: z.infer<typeof ExtractionResponseSchema> = asInterface;

  assert.equal(asSchema.fields.currency, "KRW");
});

test("the response schema rejects a body the renderer would crash on", () => {
  // The shape another service on the guessed port returns: JSON, 200, and
  // nothing the renderer can map over.
  const notAnExtraction = { ...(aResponse() as Record<string, unknown>), items: { count: 1 } };

  assert.equal(ExtractionResponseSchema.safeParse(notAnExtraction).success, false);
  assert.equal(ExtractionResponseSchema.safeParse({ status: "ok" }).success, false);
});

test("the response schema accepts, and strips, a field an older client does not know about", () => {
  // Not .strict(): a server that adds a field must not blank the whole screen.
  // Accepted is not the same as carried through — z.object() strips what it
  // does not declare, so an older client renders the parts it understands and
  // never sees the new field. Both halves are the contract.
  const withNewField = { ...(aResponse() as Record<string, unknown>), futureField: 1 };

  const parsed = ExtractionResponseSchema.safeParse(withNewField);

  assert.equal(parsed.success, true);
  assert.equal("futureField" in (parsed.data ?? {}), false);
});

test("the response schema rejects money that is not an integer minor unit", () => {
  // The contract says money is integer minor units and quantity a positive
  // integer, and ModelReplySchema enforces exactly that one level upstream. A
  // boundary that only asked "is a number" would let a mismatched server's
  // 4500.5 won past the guard the model's own reply could never pass.
  const withFractionalItem = aResponse() as { items: { amountMinor: number; quantity?: number }[] };
  withFractionalItem.items[0].amountMinor = 4500.5;

  assert.equal(ExtractionResponseSchema.safeParse(withFractionalItem).success, false);

  for (const badQuantity of [0, -1, 1.5]) {
    const response = aResponse() as { items: { quantity?: number }[] };
    response.items[0].quantity = badQuantity;

    assert.equal(ExtractionResponseSchema.safeParse(response).success, false, `quantity ${badQuantity}`);
  }

  const withFractionalSum = aResponse() as { arithmetic: { itemSumMinor: number | null } };
  withFractionalSum.arithmetic.itemSumMinor = 4500.5;

  assert.equal(ExtractionResponseSchema.safeParse(withFractionalSum).success, false);
});
