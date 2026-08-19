import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../src/analyze.ts";

const REFERENCE = new Date(2026, 6, 30);

test("analyze fills every field from a clean receipt", () => {
  const parsed = analyze(
    "Mono Market\nNoise cancelling headphones 149,000\nProtective case 40,000\n2026-07-30\nTotal 189,000\nOrder DB-240730\n",
    REFERENCE,
  );

  assert.equal(parsed.merchant?.value, "Mono Market");
  assert.equal(parsed.paidTotal?.value, 189000);
  assert.equal(parsed.currency, "KRW");
  assert.deepEqual(parsed.purchaseDate?.value, new Date(2026, 6, 30));
  assert.equal(parsed.reference?.value, "DB-240730");
  assert.equal(parsed.items.length, 2);
});

test("analyze leaves a field null rather than guessing it", () => {
  const parsed = analyze("Corner Shop\nPortable SSD\n89,000\nCard 1234\n", REFERENCE);

  assert.equal(parsed.reference, null);
  assert.equal(parsed.paidTotal?.value, 89000);
});

test("analyze quotes evidence that re-parses to the same value", () => {
  const parsed = analyze("GS25\n2026.07.02 20:20:50\n17,100\n", REFERENCE);

  assert.equal(parsed.paidTotal?.evidence.text, "17,100");
  assert.deepEqual(parsed.purchaseDate?.value, new Date(2026, 6, 2));
});

test("analyze skips an amount line when looking for the merchant", () => {
  const parsed = analyze("13,000\nGS25\n2026-07-02\n합계 13,000\n", new Date(2026, 6, 20));

  assert.equal(parsed.merchant?.value, "GS25");
});
