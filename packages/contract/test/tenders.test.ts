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

test("extractTenders ignores unsuccessful tender attempts", () => {
  for (const text of [
    "Gift Card Payment Declined $5.00",
    "Voucher Payment Failed $5.00",
    "Coupon Payment Voided $5.00",
    "Gift Certificate Payment Reversed $5.00",
  ]) {
    assert.deepEqual(extractTenders(evidenceLines(text), "USD"), [], text);
  }
});

test("extractTenders ignores a tender offer for a future payment", () => {
  const lines = evidenceLines("Coupon valid for use on next payment: $5.00");

  assert.deepEqual(extractTenders(lines, "USD"), []);
});

test("extractTenders ignores a tender offer for a future purchase", () => {
  const lines = evidenceLines("Coupon Payment: $5.00 on your next purchase");

  assert.deepEqual(extractTenders(lines, "USD"), []);
});

test("extractTenders ignores a tender reward for a future visit", () => {
  for (const text of [
    "Coupon Payment: $5.00 reward for your next visit",
    "Coupon Payment: $5.00 valid for future redemption",
    "Coupon Payment: $5.00 for a later transaction",
  ]) {
    assert.deepEqual(extractTenders(evidenceLines(text), "USD"), [], text);
  }
});

test("extractTenders ignores Korean available tender balances", () => {
  for (const text of ["사용 가능 포인트: 5,000", "쿠폰 사용 가능 금액: 5,000"]) {
    assert.deepEqual(extractTenders(evidenceLines(text), "KRW"), [], text);
  }
});

test("extractTenders keeps a payment amount before its remaining balance", () => {
  for (const [text, currency, amountMinor] of [
    ["상품권 결제금액: 5,000 잔액: 10,000", "KRW", 5000],
    ["Gift Card Payment: $5.00 Remaining Balance: $20.00", "USD", 500],
  ] as const) {
    const lines = evidenceLines(text);

    assert.deepEqual(extractTenders(lines, currency), [{ amountMinor, evidence: lines[0] }], text);
  }
});

test("extractTenders prefers a currency-marked payment amount over an identifier", () => {
  const lines = evidenceLines("Gift Card Payment 1234 $5.00");

  assert.deepEqual(extractTenders(lines, "USD"), [{ amountMinor: 500, evidence: lines[0] }]);
});

test("extractTenders ignores a hash-prefixed tender payment identifier", () => {
  const lines = evidenceLines("Gift Card Payment #1234 $5.00");

  assert.deepEqual(extractTenders(lines, "USD"), [{ amountMinor: 500, evidence: lines[0] }]);
});

test("extractTenders does not treat a hash-prefixed identifier as its only payment amount", () => {
  assert.deepEqual(extractTenders(evidenceLines("Gift Card Payment #1234"), "USD"), []);
});

test("extractTenders reads a hash-marked Korean tender amount", () => {
  const lines = evidenceLines("상품권 결제금액 #5,000");

  assert.deepEqual(extractTenders(lines, "KRW"), [{ amountMinor: 5000, evidence: lines[0] }]);
});

test("extractTenders ignores a trailing Korean approval identifier", () => {
  const lines = evidenceLines("상품권 결제금액: 5,000 승인번호: 1234");

  assert.deepEqual(extractTenders(lines, "KRW"), [{ amountMinor: 5000, evidence: lines[0] }]);
});

test("extractTenders ignores trailing English payment identifiers", () => {
  for (const suffix of ["Card Number 1234", "Authorization Code 1234"]) {
    const lines = evidenceLines(`Gift Card Payment 5.00 ${suffix}`);

    assert.deepEqual(extractTenders(lines, "USD"), [{ amountMinor: 500, evidence: lines[0] }], suffix);
  }
});

test("extractTenders reads English tender payments in USD", () => {
  for (const label of ["Gift Card", "Gift Certificate", "Voucher"]) {
    const lines = evidenceLines(`${label} Payment: $5.00`);

    assert.deepEqual(extractTenders(lines, "USD"), [{ amountMinor: 500, evidence: lines[0] }], label);
  }
});
