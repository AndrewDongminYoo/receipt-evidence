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

test("inferCurrency counts two agreeing priced-item cents rows as USD", () => {
  // Dart's cents-row gate (receipt_analyzer.dart:400) is
  // `!_isAmountOnlyRow(text) && !_isPricedItem(line)) continue;` — a row
  // counts if it is EITHER amount-only OR a priced item. Neither row here is
  // amount-only (both have a letter), so this pins the isPricedItem half of
  // the OR: with no total and no currency marker anywhere on the receipt,
  // two agreeing named, priced cents rows still infer USD.
  const lines = evidenceLines("Coffee 3.50\nTea 4.25\n");

  assert.equal(inferCurrency("Coffee 3.50\nTea 4.25", lines, null), "USD");
});
