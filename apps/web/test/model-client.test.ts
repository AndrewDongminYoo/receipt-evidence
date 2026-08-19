// This transformation runs on every real API call and on no other test in
// this suite — schema.test.ts (packages/contract) checks modelJsonSchema()
// itself, never the strict-mode-reshaped copy model-client.ts sends to
// OpenAI. If schema.ts grows a nested object toStrictSchema mishandles, the
// first place that notices is OpenAI rejecting the live request during a
// demo. This test reads the REAL emitted schema (not a fixture) so it fails
// the moment schema.ts's shape changes underneath the transform.
import assert from "node:assert/strict";
import test from "node:test";
import { modelJsonSchema } from "@receipt-evidence/contract/schema";
import { toStrictSchema } from "../src/model-client.ts";

interface JsonSchemaNode {
  type?: string;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: unknown;
  anyOf?: JsonSchemaNode[];
}

/** Walks the ORIGINAL (untransformed) schema and its transformed counterpart
 * in lockstep, so every nested object/array is checked, not only the top
 * one — which is exactly the case (modelItemSchema's `quantity`) this
 * transform has to get right. */
function assertStrictModeValid(original: JsonSchemaNode, transformed: JsonSchemaNode, path: string): void {
  if (original.type === "array" && original.items) {
    assert.equal(transformed.type, "array", `${path}: array type preserved`);
    assert.ok(transformed.items, `${path}: items schema preserved`);
    assertStrictModeValid(original.items, transformed.items as JsonSchemaNode, `${path}[]`);
    return;
  }
  if (original.type !== "object" || !original.properties) return;

  assert.equal(transformed.additionalProperties, false, `${path}: additionalProperties must be false`);
  const originalKeys = Object.keys(original.properties).sort();
  const originalRequired = new Set(original.required ?? []);
  assert.deepEqual(
    Object.keys(transformed.properties ?? {}).sort(),
    originalKeys,
    `${path}: same property keys`,
  );
  assert.deepEqual(
    [...(transformed.required ?? [])].sort(),
    originalKeys,
    `${path}: required lists every property key`,
  );

  for (const key of originalKeys) {
    const originalProp = original.properties[key] as JsonSchemaNode;
    const transformedProp = (transformed.properties as Record<string, JsonSchemaNode>)[key];
    if (originalRequired.has(key)) {
      assert.ok(!transformedProp.anyOf, `${path}.${key}: originally-required property left bare, not nullable-wrapped`);
      assertStrictModeValid(originalProp, transformedProp, `${path}.${key}`);
    } else {
      const nullBranch = transformedProp.anyOf?.find((branch) => branch.type === "null");
      const valueBranch = transformedProp.anyOf?.find((branch) => branch.type !== "null");
      assert.ok(nullBranch, `${path}.${key}: optional property must be a nullable union, not a bare optional`);
      assert.ok(valueBranch, `${path}.${key}: nullable union must still carry the real schema`);
      assertStrictModeValid(originalProp, valueBranch as JsonSchemaNode, `${path}.${key}`);
    }
  }
}

test("toStrictSchema satisfies OpenAI strict mode on the real emitted schema, at every nesting level", () => {
  const original = modelJsonSchema() as unknown as JsonSchemaNode;
  const transformed = toStrictSchema(original) as JsonSchemaNode;
  assertStrictModeValid(original, transformed, "$");
});
