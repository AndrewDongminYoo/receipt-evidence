import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../src/analyze.ts";
import { AMBIGUOUS_PAYMENT_CASES, COLUMN_PAYMENT_TEXT } from "./fixtures/column-payment.ts";

const REFERENCE = new Date(2026, 6, 30);

test("analyze leaves the column-flattened payment block unknown", () => {
  assert.equal(analyze(COLUMN_PAYMENT_TEXT, new Date(2026, 7, 29)).paidTotal, null);
});

for (const fixture of AMBIGUOUS_PAYMENT_CASES) {
  test(`analyze cannot replace an ambiguous total with the largest amount: ${fixture.name}`, () => {
    assert.equal(analyze(fixture.text, REFERENCE).paidTotal, null);
  });
}

test("analyze retains an explicit total and its unchanged evidence", () => {
  assert.deepEqual(analyze(`${COLUMN_PAYMENT_TEXT}\n결제 금액: 72,000`, REFERENCE).paidTotal, {
    value: 72000,
    evidence: { lineIndex: 15, text: "결제 금액: 72,000" },
  });
});

test("merchant financial words do not suppress otherwise supported totals", () => {
  for (const text of [
    "TOTAL WINE & MORE\nWine bottle $12.00\n$12.00",
    "TOTAL WINE & MORE\nTOTAL\n$12.00",
    "DISCOUNT STORE\nTOTAL\n$12.00",
  ]) {
    assert.equal(analyze(text, REFERENCE).paidTotal?.value, 1200, text);
  }
});

test("analyze fills every field from a clean receipt", () => {
  const parsed = analyze(
    "Mono Market\nNoise cancelling headphones 149,000\nProtective case 40,000\n2026-07-30\nTotal 189,000\nOrder DB-240730\n",
    REFERENCE,
  );

  assert.equal(parsed.merchant?.value, "Mono Market");
  assert.equal(parsed.paidTotal?.value, 189000);
  assert.equal(parsed.currency, "KRW");
  assert.deepEqual(parsed.purchaseDate?.value, new Date(2026, 6, 30));
  assert.equal(parsed.reference?.value, "DB-240730");
  assert.equal(parsed.items.length, 2);
});

test("analyze leaves a field null rather than guessing it", () => {
  const parsed = analyze("Corner Shop\nPortable SSD\n89,000\nCard 1234\n", REFERENCE);

  assert.equal(parsed.reference, null);
  assert.equal(parsed.paidTotal?.value, 89000);
});

test("analyze quotes evidence that re-parses to the same value", () => {
  const parsed = analyze("GS25\n2026.07.02 20:20:50\n17,100\n", REFERENCE);

  assert.equal(parsed.paidTotal?.evidence.text, "17,100");
  assert.deepEqual(parsed.purchaseDate?.value, new Date(2026, 6, 2));
});

test("analyze retains a Korean card payment amount before its approval number", () => {
  const parsed = analyze("상품 9,300\n신용카드 결제금액: 4,300원 승인번호: 1234\n", REFERENCE);

  assert.equal(parsed.paidTotal?.value, 4300);
  assert.equal(parsed.paidTotal?.evidence.text, "신용카드 결제금액: 4,300원 승인번호: 1234");
});

test("analyze skips an amount line when looking for the merchant", () => {
  const parsed = analyze("13,000\nGS25\n2026-07-02\n합계 13,000\n", new Date(2026, 6, 20));

  assert.equal(parsed.merchant?.value, "GS25");
});

test("analyze skips a negative amount line when looking for the merchant", () => {
  // KR-04 (docs/notes/corpus-baseline.md): isAmountOnlyRow doesn't strip a
  // leading sign, so "-1,167" was slipping through as the merchant. A
  // negative amount is still an amount, so the merchant filter strips the
  // sign before delegating.
  const parsed = analyze("-1,167\nGS25\n2026-07-02\n합계 13,000\n", new Date(2026, 6, 20));

  assert.equal(parsed.merchant?.value, "GS25");
});
