import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { extractTenders } from "../src/tenders.ts";

test("extractTenders reads an explicitly labelled gift-certificate payment", () => {
  const lines = evidenceLines("상품권명: GS25 모바일 상품권\n상품권결제금액: 5,000\n잔액: 0\n");

  assert.deepEqual(extractTenders(lines, "KRW"), [{ amountMinor: 5000, evidence: lines[1] }]);
});

test("extractTenders ignores a gift-certificate name without a payment amount", () => {
  const lines = evidenceLines("상품권명: GS25 모바일 상품권\n잔액: 5,000\n");

  assert.deepEqual(extractTenders(lines, "KRW"), []);
});

test("extractTenders ignores a tender balance that mentions payment", () => {
  const lines = evidenceLines("Gift Card Balance after Payment: $5.00");

  assert.deepEqual(extractTenders(lines, "USD"), []);
});

test("extractTenders reads English tender payments in USD", () => {
  for (const label of ["Gift Card", "Gift Certificate", "Voucher"]) {
    const lines = evidenceLines(`${label} Payment: $5.00`);

    assert.deepEqual(extractTenders(lines, "USD"), [{ amountMinor: 500, evidence: lines[0] }], label);
  }
});
