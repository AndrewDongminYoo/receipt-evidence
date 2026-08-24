import assert from "node:assert/strict";
import test from "node:test";
import { checkArithmetic } from "../src/arithmetic.ts";

test("checkArithmetic agrees when the items sum to the total", () => {
  const result = checkArithmetic([{ amountMinor: 13000 }, { amountMinor: 1700 }, { amountMinor: 100 }], 14800);

  assert.deepEqual(result, { itemSumMinor: 14800, claimedTotalMinor: 14800, reconciledTenderMinor: null, agrees: true });
});

test("checkArithmetic reports a mismatch without correcting it", () => {
  const result = checkArithmetic([{ amountMinor: 13000 }], 14800);

  assert.deepEqual(result, { itemSumMinor: 13000, claimedTotalMinor: 14800, reconciledTenderMinor: null, agrees: false });
});

test("checkArithmetic answers null when either side is missing", () => {
  assert.equal(checkArithmetic([], 14800).agrees, null);
  assert.equal(checkArithmetic([{ amountMinor: 100 }], null).agrees, null);
});

test("checkArithmetic reconciles an item total with an additional tender", () => {
  const result = checkArithmetic([{ amountMinor: 2400 }, { amountMinor: 4000 }, { amountMinor: 2900 }], 4300, [5000]);

  assert.deepEqual(result, {
    itemSumMinor: 9300,
    claimedTotalMinor: 4300,
    reconciledTenderMinor: 5000,
    agrees: true,
  });
});
