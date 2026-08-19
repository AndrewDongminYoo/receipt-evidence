import assert from "node:assert/strict";
import test from "node:test";
import { canUseAsAmount, parseAmountMinor } from "../src/amounts.ts";

test("parseAmountMinor reads won as whole units and dollars as cents", () => {
  assert.equal(parseAmountMinor("₩14,800", "KRW"), 14800);
  assert.equal(parseAmountMinor("TOTAL $24.95", "USD"), 2495);
});

test("parseAmountMinor rejoins a thousands separator split by OCR", () => {
  assert.equal(parseAmountMinor("13, 364", "KRW"), 13364);
});

test("parseAmountMinor keeps a clock time out of the amount", () => {
  assert.equal(parseAmountMinor("2026.07.02 20:20:50", "KRW"), null);
});

test("parseAmountMinor rejects digit runs too long to be money", () => {
  assert.equal(parseAmountMinor("78901234567890123456", "KRW"), null);
});

test("canUseAsAmount rejects a line that is only a date", () => {
  assert.equal(canUseAsAmount({ lineIndex: 0, text: "2026-07-01" }), false);
});
