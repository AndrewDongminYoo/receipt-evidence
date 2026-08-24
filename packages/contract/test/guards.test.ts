import assert from "node:assert/strict";
import test from "node:test";
import { excerptContainsAmount, excerptContainsText, verifyEvidence } from "../src/guards.ts";

test("excerptContainsAmount accepts a value the excerpt states, in either currency's rendering", () => {
  assert.equal(excerptContainsAmount("합계 14,800", 14800), true);
  // The case the removed port got wrong: minor units against a printed
  // decimal. Half this corpus is English, so this was every USD amount.
  assert.equal(excerptContainsAmount("TOTAL $24.95", 2495), true);
  assert.equal(excerptContainsAmount("SANDWICH  12.99", 1299), true);
});

test("excerptContainsAmount reads a row that prints more than one number", () => {
  // The other case the port got wrong: it demanded exactly one numeric token.
  // A quantity beside a price is an ordinary receipt row — schema.ts asks the
  // model for `quantity`, and total.ts documents `TOTAL 2 ITEMS $24.95`.
  assert.equal(excerptContainsAmount("커피 2 4,500", 4500), true);
  assert.equal(excerptContainsAmount("TOTAL 2 ITEMS 24.95", 2495), true);
  assert.equal(excerptContainsAmount("2 x COFFEE 4,500", 4500), true);
});

test("excerptContainsAmount rejects a value the excerpt never states", () => {
  assert.equal(excerptContainsAmount("합계 14,800", 13000), false);
  // Present as a substring of a longer number, but not as an amount on the line.
  assert.equal(excerptContainsAmount("합계 14,800", 480), false);
  // Only a run LONGER than 15 digits is skipped as a barcode, which is the
  // parser's own threshold (amounts.ts MAX_WHOLE_DIGITS). Measured, not
  // assumed: 15 digits is still read as money, 16 is not. So EN-05's 14-digit
  // cashier ID does verify — this guard asks whether a number was invented,
  // and that one really is printed on the line. Misreading which number means
  // what is a different failure, and the corpus baseline is what records it.
  assert.equal(excerptContainsAmount("Cashier: 789012345678901", 789012345678901), true);
  assert.equal(excerptContainsAmount("Cashier: 7890123456789012", 7890123456789012), false);
  assert.equal(excerptContainsAmount("합계 14,800", 14800.5), false);
});

test("excerptContainsText accepts a value the excerpt states and fails closed on an empty one", () => {
  assert.equal(excerptContainsText("BLUE BOTTLE COFFEE", "BLUE BOTTLE"), true);
  assert.equal(excerptContainsText("주문번호  A-12345", "A-12345"), true);
  assert.equal(excerptContainsText("TOTAL  12.99", "TOTALLY-MADE-UP-9999"), false);
  // Every string contains the empty string; without the check a model
  // returning "" for a merchant would have it published as verified.
  assert.equal(excerptContainsText("TOTAL  12.99", ""), false);
  assert.equal(excerptContainsText("TOTAL  12.99", "   "), false);
});

test("excerptContainsText compares the way verifyEvidence does, so the two cannot drift", () => {
  assert.equal(excerptContainsText("합계　１４，８００", "합계 14,800"), true);
  assert.equal(excerptContainsText("BLUE   BOTTLE", "BLUE BOTTLE"), true);
});

test("verifyEvidence rejects an excerpt absent from the page text", () => {
  const page = "GS25\n합계 14,800\n";

  assert.equal(verifyEvidence("합계 14,800", page), true);
  assert.equal(verifyEvidence("합계 99,999", page), false);
});

test("verifyEvidence compares after NFKC normalisation", () => {
  assert.equal(verifyEvidence("１４，８００", "합계 14,800"), true);
});

test("verifyEvidence rejects an empty or whitespace-only excerpt", () => {
  const page = "GS25\n합계 14,800\n";

  assert.equal(verifyEvidence("", page), false);
  assert.equal(verifyEvidence("   ", page), false);
  assert.equal(verifyEvidence("　", page), false); // ideographic space, NFKC-normalises to a space
});

test("verifyEvidence rejects an excerpt spliced from lines that are not adjacent", () => {
  // This used to assert that ANY two-line excerpt was rejected. Evidence may
  // now span up to MAX_EVIDENCE_LINES adjacent lines, because a Korean
  // receipt prints an item's name and its price on separate lines — so the
  // fixture was re-aimed at what the rule still has to stop rather than
  // weakened to match the code. Adjacency is the constraint: a label from the
  // top of the receipt cannot be joined to an amount from the bottom.
  const page = "아메리카노 1개\n합계\n소계 4500\n부가세 450\n";

  assert.equal(verifyEvidence("아메리카노 1개\n부가세 450", page), false, "first line spliced onto the last");
  assert.equal(verifyEvidence("합계\n부가세 450", page), false, "one line skipped in between");
  assert.equal(verifyEvidence("합계\n소계 4500", page), true, "consecutive, so a real quote");
});

test("verifyEvidence accepts an item split across the lines its receipt printed it on", () => {
  // The capture that forced this: a 7-Eleven receipt whose OCR put the item
  // name, its barcode and its price on three lines. The model quoted all
  // three — a correct reading — and the one-line rule rejected it.
  const page = "7-ELEVEN\n하리보)푸르티부시젤리100\n4001686375754\n2,500\n합 계 #2,500\n";

  assert.equal(verifyEvidence("하리보)푸르티부시젤리100\n4001686375754\n2,500", page), true);
});

test("verifyEvidence refuses a run longer than the cap, so a page cannot be quoted whole", () => {
  // Without a cap the relaxation would undo the guard: quote everything and
  // every value in it verifies, which is the empty-excerpt failure in a
  // longer coat.
  const page = "GS25\n2026-07-02\n커피 4,500\n합계 4,500\n";

  assert.equal(verifyEvidence("GS25\n2026-07-02\n커피 4,500\n합계 4,500", page), true, "four lines is the cap");
  assert.equal(
    verifyEvidence("GS25\n2026-07-02\n커피 4,500\n합계 4,500\n감사합니다", `${page}감사합니다\n`),
    false,
    "five is past it",
  );
});

test("verifyEvidence accepts the four-line item shape a real receipt printed", () => {
  // The second device capture: OCR split the quantity onto its own line, so
  // the item ran name / barcode / quantity / amount. At a cap of three a
  // correct model reading was rejected.
  const page = "7-ELEVEN\n해태)홈런볼피스타치오카\n8801019320293\n1\n2,000\n합계 #2,000\n";

  assert.equal(verifyEvidence("해태)홈런볼피스타치오카\n8801019320293\n1\n2,000", page), true);
});

test("a real excerpt carrying a value it never states is rejected", () => {
  // The subtler hallucination, and the one the value guard exists for: the
  // model quotes a line that genuinely exists and attaches a number that is
  // not in it. verifyEvidence passes here — only the value guard catches it.
  const page = "GS25\n합계 14,800\n";

  assert.equal(verifyEvidence("합계 14,800", page), true);
  assert.equal(excerptContainsAmount("합계 14,800", 13000), false);
});

test("a fabricated model value cannot pass the guard", () => {
  // The regression that gives this whole project its point: delete either
  // guard and this test must fail. Both halves are exercised — a number the
  // page never printed, and a string attached to a line that never said it.
  const page = "GS25\n합계 14,800\n";
  const fabricatedNumber = { value: 148000, excerpt: "합계 148,000" };
  const fabricatedString = { value: "COSTCO", excerpt: "합계 14,800" };

  assert.equal(
    verifyEvidence(fabricatedNumber.excerpt, page) &&
      excerptContainsAmount(fabricatedNumber.excerpt, fabricatedNumber.value),
    false,
    "an invented line: verifyEvidence is the half that catches it",
  );
  assert.equal(
    verifyEvidence(fabricatedString.excerpt, page) &&
      excerptContainsText(fabricatedString.excerpt, fabricatedString.value),
    false,
    "a real line quoted for a value it never carried: only the value guard catches it",
  );
});

test("excerptContainsText requires the value to stand on its own token boundaries", () => {
  // A bare substring test shipped both of these as verified.
  assert.equal(excerptContainsText("승인번호 A-12345", "A-12345"), true, "the reference the line states");
  assert.equal(excerptContainsText("승인번호 A-12345", "12345"), false, "a truncation of it is not it");
  assert.equal(excerptContainsText("SUBTOTAL 12.99", "TOTAL"), false, "TOTAL is not what SUBTOTAL says");
  assert.equal(excerptContainsText("BLUE BOTTLE COFFEE", "O"), false, "a single letter is not a merchant");
  // …without rejecting the values a receipt really does print.
  assert.equal(excerptContainsText("주문번호: A-12345.", "A-12345"), true, "punctuation is not a token character");
  assert.equal(excerptContainsText("TOTAL 12.99 SUBTOTAL 12.99", "SUBTOTAL"), true, "a later occurrence still counts");
});
