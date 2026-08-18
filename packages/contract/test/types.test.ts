import assert from "node:assert/strict";
import test from "node:test";
import { isMoney } from "../src/types.ts";

test("isMoney accepts integer minor units and rejects floats", () => {
  assert.equal(isMoney({ amountMinor: 14800, currency: "KRW" }), true);
  assert.equal(isMoney({ amountMinor: 148.5, currency: "USD" }), false);
  assert.equal(isMoney({ amountMinor: 100, currency: "EUR" }), false);
});
