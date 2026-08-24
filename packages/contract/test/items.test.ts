import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { extractItems } from "../src/items.ts";

test("extractItems reads priced items with their evidence lines", () => {
  const lines = evidenceLines(
    "Mono Market\nNoise cancelling headphones 149,000\nProtective case 40,000\n2026-07-30\nTotal 189,000\n",
  );

  const items = extractItems(lines, "KRW");

  assert.equal(items.length, 2);
  assert.equal(items[0].name, "Noise cancelling headphones");
  assert.equal(items[0].amountMinor, 149000);
  assert.equal(items[0].nameEvidence.lineIndex, 1);
  assert.equal(items[1].amountEvidence.text, "Protective case 40,000");
});

test("extractItems excludes settlement and column-header rows", () => {
  const lines = evidenceLines("OIL CHANGE 39.99\nCHANGE DUE 7.01\nQTY 1.00\n거스름 500\n");

  assert.deepEqual(
    extractItems(lines, "USD").map((item) => item.name),
    ["OIL CHANGE"],
  );
});

test("extractItems needs a name, not only punctuation", () => {
  const lines = evidenceLines("2@ 2.05\n$ 41.00\n");

  assert.deepEqual(extractItems(lines, "USD"), []);
});
