import assert from "node:assert/strict";
import test from "node:test";
import { ModelReplySchema, modelJsonSchema } from "../src/schema.ts";

test("the schema requires evidence on every value", () => {
  const withoutEvidence = { items: [{ name: "커피", quantity: 1, amountMinor: 4500 }] };

  assert.equal(ModelReplySchema.safeParse(withoutEvidence).success, false);
});

test("the schema accepts a fully evidenced reply", () => {
  const reply = {
    items: [
      { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
    ],
    merchant: { value: "GS25", evidence: { pageIndex: 0, excerpt: "GS25" } },
  };

  assert.equal(ModelReplySchema.safeParse(reply).success, true);
});

test("the JSON schema handed to the model matches the zod definition", () => {
  const jsonSchema = modelJsonSchema();

  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.items, "items must be present in the JSON schema");
  assert.equal(jsonSchema.additionalProperties, false);
});

test("the schema rejects an empty or whitespace-only excerpt", () => {
  const emptyExcerpt = {
    items: [
      { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "" } },
    ],
  };
  const whitespaceExcerpt = {
    items: [
      { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "   " } },
    ],
  };

  assert.equal(ModelReplySchema.safeParse(emptyExcerpt).success, false);
  assert.equal(ModelReplySchema.safeParse(whitespaceExcerpt).success, false);
});

test("a reply carrying an invented field is rejected, not silently stripped", () => {
  const reply = {
    items: [
      { name: "커피", quantity: 1, amountMinor: 4500, evidence: { pageIndex: 0, excerpt: "커피 4,500" } },
    ],
    confidence: 0.91,
  };

  assert.equal(ModelReplySchema.safeParse(reply).success, false);
});
