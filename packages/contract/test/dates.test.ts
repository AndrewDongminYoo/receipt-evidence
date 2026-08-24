import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLines } from "../src/evidence.ts";
import { parseDate, selectDate } from "../src/dates.ts";

test("parseDate reads Korean, dotted, and slashed forms", () => {
  assert.deepEqual(parseDate("2026년 7월 1일"), new Date(2026, 6, 1));
  assert.deepEqual(parseDate("2026년 7월 1"), new Date(2026, 6, 1));
  assert.deepEqual(parseDate("2026.07.29 18:42"), new Date(2026, 6, 29));
  assert.deepEqual(parseDate("07/29/2026"), new Date(2026, 6, 29));
});

test("parseDate keeps bounded four-digit historical years", () => {
  assert.deepEqual(parseDate("1999년 12월 31일"), new Date(1999, 11, 31));
  assert.deepEqual(parseDate("12/31/1999"), new Date(1999, 11, 31));
});

test("parseDate rejects a calendar-invalid date", () => {
  assert.equal(parseDate("2026-02-31"), null);
});

test("parseDate ignores a short date embedded in a longer identifier", () => {
  assert.equal(parseDate("78901234567890123456"), null);
});

test("parseDate skips a calendar-invalid match and takes the valid one beside it", () => {
  assert.deepEqual(parseDate("2026-02-31 승인 2026-07-01"), new Date(2026, 6, 1));
});

test("selectDate skips expiry labels and future dates", () => {
  const reference = new Date(2026, 6, 20);
  const lines = evidenceLines("유효기간 2027-01-01\n2028-05-05\n2026-07-02 20:20:50\n");

  assert.equal(selectDate(lines, reference)?.text, "2026-07-02 20:20:50");
});

test("selectDate skips a four-digit identifier that is not a receipt year", () => {
  const reference = new Date(2026, 7, 24);
  const lines = evidenceLines("현금영수증 발행번호 0126-1-1\n2026/08/12 (수) 17:47:31\n");

  assert.equal(selectDate(lines, reference)?.text, "2026/08/12 (수) 17:47:31");
});

test("parseDate rejects a four-digit date embedded in an identifier", () => {
  assert.equal(parseDate("12026-08-12"), null);
  assert.equal(parseDate("2026-08-123"), null);
  assert.equal(parseDate("2026년 8월 12일3"), null);
});
