import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { inferCurrency } from "../src/currency.ts";

test("inferCurrency reads 원 as currency only after an amount", () => {
  const money = evidenceLines("합계 12,900원\n");
  const coffee = evidenceLines("원두커피 $4.50\n");

  assert.equal(inferCurrency("합계 12,900원", money, money[0]), "KRW");
  assert.equal(inferCurrency("원두커피 $4.50", coffee, coffee[0]), "USD");
});

test("inferCurrency keeps a dotted date out of cents detection", () => {
  const lines = evidenceLines("GS25\n2026.07.02 20:20:50\n17,100\n");

  assert.equal(inferCurrency("GS25\n2026.07.02 20:20:50\n17,100", lines, lines[2]), "KRW");
});

test("inferCurrency reads a fare row as USD — TAXI is not a tax row", () => {
  // receipt_analyzer_test.dart:611-620 asserts exactly this and nothing else:
  // `\btax\b` matches as a whole word, so TAXI never triggers the tax label.
  const lines = evidenceLines("City Cabs\nTAXI FARE $12.99\n");

  assert.equal(inferCurrency("City Cabs\nTAXI FARE $12.99", lines, null), "USD");
});

test("inferCurrency: priced item rows are not cents-eligible until _isPricedItem is ported", () => {
  // Dart's cents-row gate (receipt_analyzer.dart:400) is
  // `!_isAmountOnlyRow(text) && !_isPricedItem(line)) continue;` — a row
  // counts if it is EITHER amount-only OR a priced item. This TS port only
  // has the amount-only half, so a named, non-amount-only priced row (has a
  // letter, so `isAmountOnlyRow` is false) is never cents-eligible here,
  // even with no total and no currency marker anywhere on the receipt.
  //
  // These two rows would be priced items in Dart, so once items.ts (Task 7)
  // exists and `_isPricedItem` is ported into this OR, this assertion is
  // expected to become "USD" — that flip is the signal the gap closed, not
  // a regression.
  const lines = evidenceLines("Coffee 3.50\nTea 4.25\n");

  assert.equal(inferCurrency("Coffee 3.50\nTea 4.25", lines, null), "KRW");
});
