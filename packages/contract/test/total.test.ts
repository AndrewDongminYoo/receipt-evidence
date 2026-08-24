import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { isAmountOnlyRow, selectTotal } from "../src/total.ts";

test("selectTotal ignores discount, subtotal and tax rows", () => {
  const lines = evidenceLines("소계 20,000\n할인금액 -6,600\n합계 14,800\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "합계 14,800");
});

test("selectTotal ignores a gift-certificate payment that follows the card payment", () => {
  const lines = evidenceLines("신용카드 결제금액: 4,300원\n상품권 결제금액: 5,000\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "신용카드 결제금액: 4,300원");
});

test("selectTotal ignores card-payment metadata that follows the total", () => {
  for (const metadata of ["Reference 1234", "Authorization 1234", "Approval Code 1234", "Balance $5.00", "Fee $0.25"]) {
    const lines = evidenceLines(`TOTAL $12.99\nCredit Card Payment ${metadata}\n`);

    assert.equal(selectTotal(lines, "USD")?.text, "TOTAL $12.99", metadata);
  }
});

test("selectTotal ignores authorization metadata when the total has no label", () => {
  for (const metadata of ["Authorization 1234", "Approval Code 1234"]) {
    const lines = evidenceLines(`$10.00\nCredit Card Payment ${metadata}\n`);

    assert.equal(selectTotal(lines, "USD")?.text, "$10.00", metadata);
  }
});

test("selectTotal ignores unsuccessful card-payment attempts", () => {
  for (const status of ["Declined", "Failed", "Voided", "Reversed"]) {
    const lines = evidenceLines(`$10.00\nCredit Card Payment ${status} $12.99\n`);

    assert.equal(selectTotal(lines, "USD")?.text, "$10.00", status);
  }
});

test("selectTotal prefers an explicit total over settlement contributions", () => {
  const lines = evidenceLines("TOTAL $12.99\nGift Card Payment $5.00\nCredit Card Payment $7.99\n");

  assert.equal(selectTotal(lines, "USD")?.text, "TOTAL $12.99");
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

test("a currency glyph decides the total when OCR scrambled the label order", () => {
  // The 7-Eleven capture: Vision emitted the big bold `합계` ABOVE the
  // `부  가  세` row it sits below on paper, so the label run read
  // [합계, 부 가 세] against values [182, #2,000] and positional pairing gave
  // the VAT. On the device that shipped as `Paid total: 182` with `"182"` as
  // its evidence.
  const lines = evidenceLines("과세물품가액\n1,818\n합계\n부  가  세\n182\n#2,000\n");

  assert.equal(selectTotal(lines, "KRW")?.text, "#2,000");
});

test("# before a digit is the won glyph a printer without ₩ uses", () => {
  assert.equal(isAmountOnlyRow("#2,000"), true, "an amount row, so it can be a split total's value");
  assert.equal(isAmountOnlyRow("2,000"), true);
  // Narrow on purpose: # before a letter is an item or store number.
  assert.equal(isAmountOnlyRow("세븐일레븐 뚝섬리버빌점#19345"), false);
});

test("the split-total lookahead stops at a label that claims the next value", () => {
  // Without the guard the walk steps over `부  가  세` and hands 합계 the
  // VAT's number. Distinct from the column-aligned case above: here there is
  // no value run to pair, just a label and one value after it.
  const lines = evidenceLines("합계\n부  가  세\n182\n");

  assert.notEqual(selectTotal(lines, "KRW")?.text, "182", "never the figure the other label named");
});
