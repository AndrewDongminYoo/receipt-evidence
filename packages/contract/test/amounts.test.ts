import assert from "node:assert/strict";
import test from "node:test";
import { amountsOnLine, canUseAsAmount, parseAmountMinor } from "../src/amounts.ts";

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

test("an amount too large to scale exactly is skipped, not silently rounded", () => {
  // Dart scales in a 64-bit int where this is exact; JS has only doubles.
  // "123456789012345.67" came back as 12345678901234568 — one off what the
  // line printed — and excerptContainsAmount then verified a value that was
  // never on it, because both are the same double.
  assert.deepEqual(amountsOnLine("X 123456789012345.67"), [], "not representable, so not an amount");
  assert.deepEqual(amountsOnLine("X 90071992547409.91"), [9007199254740991], "the largest one that still is");
  assert.deepEqual(amountsOnLine("합계 14,800"), [14800], "ordinary money is untouched");
});
