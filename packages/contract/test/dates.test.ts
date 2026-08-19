import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { parseDate, selectDate } from "../src/dates.ts";

test("parseDate reads Korean, dotted, and slashed forms", () => {
  assert.deepEqual(parseDate("2026년 7월 1일"), new Date(2026, 6, 1));
  assert.deepEqual(parseDate("2026.07.29 18:42"), new Date(2026, 6, 29));
  assert.deepEqual(parseDate("07/29/2026"), new Date(2026, 6, 29));
});

test("parseDate rejects a calendar-invalid date", () => {
  assert.equal(parseDate("2026-02-31"), null);
});

test("parseDate ignores a short date embedded in a longer identifier", () => {
  assert.equal(parseDate("78901234567890123456"), null);
});

test("selectDate skips expiry labels and future dates", () => {
  const reference = new Date(2026, 6, 20);
  const lines = evidenceLines("유효기간 2027-01-01\n2028-05-05\n2026-07-02 20:20:50\n");

  assert.equal(selectDate(lines, reference)?.text, "2026-07-02 20:20:50");
});
