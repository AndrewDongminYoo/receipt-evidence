import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { selectTotal } from "../src/total.ts";

test("selectTotal ignores discount, subtotal and tax rows", () => {
  const lines = evidenceLines("소계 20,000\n할인금액 -6,600\n합계 14,800\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "합계 14,800");
});

test("selectTotal keeps a paid total that also reports an item count", () => {
  const lines = evidenceLines("TOTAL 2 ITEMS $24.95\n");

  assert.equal(selectTotal(lines, "USD")?.text, "TOTAL 2 ITEMS $24.95");
});

test("selectTotal rejects a count row carrying no money", () => {
  const lines = evidenceLines("TOTAL NUMBER OF ITEMS SOLD - 10\n");

  assert.equal(selectTotal(lines, "USD"), null);
});

test("selectTotal yields no evidence for a labelled fare row", () => {
  // The no-label fallback accepts a row that is a currency-marked amount and
  // NOTHING else, which is how `SUBTOTAL $20.00`, `TENDER $20.00` and
  // `TAX $1.05` stay out (receipt_analyzer.dart:338-341). A fare row has the
  // same shape, so it is excluded too and the receipt gets a total with no
  // evidence line. That "TAXI" is not read as a tax row is a currency-inference
  // claim, and Task 6 pins it.
  const lines = evidenceLines("TAXI FARE $12.99\n");

  assert.equal(selectTotal(lines, "USD"), null);
});

test("selectTotal pairs a total printed on the following line", () => {
  const lines = evidenceLines("TOTAL\n189,000\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "189,000");
});
