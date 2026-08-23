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

test("selectTotal pairs stacked labels with their column-aligned values", () => {
  // The columnAlignedValue branch: OCR flattens a two-column block into all
  // its labels, then all its values, so the nth label must pair with the
  // nth value rather than the first value after it. Measured unexercised by
  // all 12 real corpus fixtures (docs/notes/corpus-baseline.md) — this is
  // the dedicated test Task 5's review flagged as missing.
  const lines = evidenceLines("SUBTOTAL:\nTAX:\nTOTAL:\n5.50\n0.53\n6.03\n");

  assert.equal(selectTotal(lines, "USD")?.text, "6.03");
});

test("selectTotal reads a Korean label whose characters are letter-spaced", () => {
  // From the first real device capture, a 7-Eleven receipt: the printer spaces
  // its labels, so OCR returns `합 계` and `부 가 세`. Against the tight-only
  // pattern the label missed, selectTotal fell through to its largest-amount
  // fallback, and the product BARCODE shipped as the paid total — verified,
  // with a box drawn over it on the photo.
  const lines = evidenceLines("하리보)푸르티부시젤리100\n4001686375754  1  2,500\n부 가 세  227\n합 계  #2,500\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "합 계  #2,500");
  assert.notEqual(selectTotal(lines, "KRW")?.text, "4001686375754  1  2,500", "never the barcode row");
});

test("a letter-spaced VAT row is still excluded from the total", () => {
  // The other half: if `부 가 세` also missed, the tax row became a candidate.
  const lines = evidenceLines("커피 4,500\n부 가 세  409\n");

  assert.equal(selectTotal(lines, "KRW"), null, "a receipt with only a tax row has no total");
});
