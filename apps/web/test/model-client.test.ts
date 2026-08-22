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
import { buildInput, toStrictSchema } from "../src/model-client.ts";
import type { Page } from "../src/extract.ts";

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

/** The user message's content parts, in order. `buildInput` is the only place
 * that decides what leaves the machine, and the fake ModelClient the pipeline
 * tests use replaces the whole client — so this is the one seam where "does
 * the image actually travel?" can be asked without a network call. */
function userParts(pages: readonly Page[]): { type: string; text?: string; image_url?: string | null }[] {
  const input = buildInput(pages) as { role: string; content: unknown }[];
  const user = input.find((message) => message.role === "user");
  assert.ok(user, "buildInput must emit a user message");
  assert.ok(Array.isArray(user.content), "user content must be a content-part list, not a joined string");
  return user.content as { type: string; text?: string; image_url?: string | null }[];
}

const JPEG = "data:image/jpeg;base64,QUJD";

test("buildInput sends a page's image only when the caller attached one", () => {
  const withImage = userParts([{ text: "TOTAL 12,900", lines: [], imageDataUrl: JPEG }]);
  assert.deepEqual(
    withImage.filter((part) => part.type === "input_image"),
    [{ type: "input_image", detail: "auto", image_url: JPEG }],
    "a page carrying an image must transmit it verbatim, data URL and all",
  );

  const withoutImage = userParts([{ text: "TOTAL 12,900", lines: [] }]);
  assert.deepEqual(
    withoutImage.filter((part) => part.type === "input_image"),
    [],
    "a page above the OCR floor carries no image, so none may be sent",
  );
  assert.ok(
    withoutImage.some((part) => part.text?.includes("TOTAL 12,900")),
    "the page's text still travels when its image does not",
  );
});

test("buildInput attaches the image to the page it belongs to, not to the request", () => {
  // The spec's real shape: a multi-page receipt where only the second page
  // fell below the OCR floor. The image must follow its own page's text, or
  // the model reads it against the wrong page's excerpts.
  const parts = userParts([
    { text: "page zero text", lines: [] },
    { text: "page one text", lines: [], imageDataUrl: JPEG },
  ]);
  assert.deepEqual(
    parts.map((part) => (part.type === "input_image" ? "image" : part.text)),
    ["Page 0:\npage zero text", "Page 1:\npage one text", "image"],
    "one text part per page, in page order, with the image directly after the page that carried it",
  );
});
