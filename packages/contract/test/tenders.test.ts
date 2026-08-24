import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { extractTenders } from "../src/tenders.ts";

test("extractTenders reads an explicitly labelled gift-certificate payment", () => {
  const lines = evidenceLines("상품권명: GS25 모바일 상품권\n상품권결제금액: 5,000\n잔액: 0\n");

  assert.deepEqual(extractTenders(lines), [{ amountMinor: 5000, evidence: lines[1] }]);
});

test("extractTenders ignores a gift-certificate name without a payment amount", () => {
  const lines = evidenceLines("상품권명: GS25 모바일 상품권\n잔액: 5,000\n");

  assert.deepEqual(extractTenders(lines), []);
});
