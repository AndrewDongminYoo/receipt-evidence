import assert from "node:assert/strict";
import test from "node:test";
import { excerptContainsValue, verifyEvidence } from "../src/guards.ts";

test("excerptContainsValue accepts a value that occurs in its excerpt", () => {
  assert.equal(excerptContainsValue("합계 14,800", 14800), true);
  assert.equal(excerptContainsValue("TOTAL $24.95", 2495), false); // minor units are the caller's job
});

test("excerptContainsValue rejects a value the excerpt never states", () => {
  assert.equal(excerptContainsValue("합계 14,800", 13000), false);
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

test("verifyEvidence rejects an excerpt spliced from two lines", () => {
  const page = "아메리카노 1개\n합계\n소계 4500\n부가세 450\n";

  assert.equal(verifyEvidence("합계\n소계 4500", page), false);
});

test("a real excerpt carrying a value it never states is rejected", () => {
  // The subtler hallucination, and the one catfood-feeder's guard was built for:
  // the model quotes a line that genuinely exists and attaches a number that is
  // not in it. verifyEvidence passes here — only excerptContainsValue catches it.
  const page = "GS25\n합계 14,800\n";

  assert.equal(verifyEvidence("합계 14,800", page), true);
  assert.equal(excerptContainsValue("합계 14,800", 13000), false);
});

test("a fabricated model value cannot pass the guard", () => {
  // The regression that gives this whole project its point: delete either guard
  // and this test must fail.
  const page = "GS25\n합계 14,800\n";
  const fabricated = { value: 148000, excerpt: "합계 148,000" };

  assert.equal(
    verifyEvidence(fabricated.excerpt, page) && excerptContainsValue(fabricated.excerpt, fabricated.value),
    false,
  );
});
