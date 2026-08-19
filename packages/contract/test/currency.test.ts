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

test("inferCurrency counts two agreeing cents rows as USD with no total and no symbol", () => {
  // Pins the `_isPricedItem` OR-branch omission (receipt_analyzer.dart:400):
  // this TS port only accepts amount-only rows into the cents-row count, so
  // two bare cents amounts must still agree to USD without any $/KRW/USD
  // marker or currency-marked total.
  const lines = evidenceLines("Corner Store\n12.99\n3.50\n");

  assert.equal(inferCurrency("Corner Store\n12.99\n3.50", lines, null), "USD");
});
