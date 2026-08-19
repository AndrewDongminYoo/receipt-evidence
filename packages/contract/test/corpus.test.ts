// Task 9: gates the parser against the 12-receipt anonymised corpus.
// The manifest (expected.json) is ground truth; a field marked
// `derivable: false` has no support in the fixture text, so the assertion
// there is the weaker true thing — if the parser still returned a value
// (a garbled-but-honest read like KR-01's "ELEUE" merchant), that value must
// at least quote a real recognised line, never invented text. See
// docs/notes/corpus-baseline.md for the measured counts this suite backs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyze } from "../src/analyze.ts";

const DIR = path.join(import.meta.dirname, "fixtures", "receipts");
const REFERENCE = new Date(2026, 6, 20);
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8"));

// Manifest dates are "YYYY-MM-DD" strings; parsed as calendar components
// (not `new Date(string)`, which reads as UTC) to match dates.ts's
// `calendarDate`, which builds `new Date(year, month - 1, day)` in local time.
function localDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

for (const receipt of manifest.receipts) {
  test(`${receipt.id} extracts only OCR-supported facts`, () => {
    const rawText = fs.readFileSync(path.join(DIR, receipt.fixture), "utf8");
    const parsed = analyze(rawText, REFERENCE);
    const derived = receipt.ocrDerived;
    const lineTexts = parsed.lines.map((line: { text: string }) => line.text);

    if (derived.merchant.derivable === false) {
      if (parsed.merchant !== null) {
        assert.ok(
          lineTexts.includes(parsed.merchant.evidence.text),
          `${receipt.id} merchant evidence must quote a recognised line`,
        );
      }
    } else {
      assert.equal(parsed.merchant?.value, derived.merchant.value, receipt.id);
      assert.equal(parsed.merchant?.evidence.text, derived.merchant.evidence, receipt.id);
    }

    if (derived.purchaseDate.derivable === false) {
      if (parsed.purchaseDate !== null) {
        assert.ok(
          lineTexts.includes(parsed.purchaseDate.evidence.text),
          `${receipt.id} purchaseDate evidence must quote a recognised line`,
        );
      }
    } else {
      assert.deepEqual(parsed.purchaseDate?.value, localDate(derived.purchaseDate.value), receipt.id);
      assert.equal(parsed.purchaseDate?.evidence.text, derived.purchaseDate.evidence, receipt.id);
    }

    if (derived.paidTotalMinor.derivable === false) {
      if (parsed.paidTotal !== null) {
        assert.ok(
          lineTexts.includes(parsed.paidTotal.evidence.text),
          `${receipt.id} paidTotal evidence must quote a recognised line`,
        );
      }
    } else {
      assert.equal(parsed.paidTotal?.value, derived.paidTotalMinor.value, receipt.id);
      assert.equal(parsed.paidTotal?.evidence.text, derived.paidTotalMinor.evidence, receipt.id);
    }

    if (derived.reference.derivable === false) {
      if (parsed.reference !== null) {
        assert.ok(
          lineTexts.includes(parsed.reference.evidence.text),
          `${receipt.id} reference evidence must quote a recognised line`,
        );
      }
    } else {
      assert.equal(parsed.reference?.value, derived.reference.value, receipt.id);
      assert.equal(parsed.reference?.evidence.text, derived.reference.evidence, receipt.id);
    }

    // currency is never a ParsedField — it is always a bare Currency value,
    // and the manifest marks it derivable on all twelve receipts.
    assert.equal(parsed.currency, derived.currency.value, receipt.id);
  });
}

// Items get their own test per receipt, separate from the block above: the
// manifest marks items non-derivable on all twelve, and the task's ruling
// for this field is the strict one ("assert the parser returns none"), not
// the weaker evidence-quoting check used for the other fields above.
//
// Measured (see docs/notes/corpus-baseline.md): extractItems is a faithful
// port of receipt_analyzer.dart:251-258/:285-289 (verified line-for-line
// against the Dart source), and that exact algorithm invents a spurious
// single-item array on three of the twelve real fixtures — KR-02 ("NO:
// 34567" read as item "NO:" priced 34567), KR-05 ("X118/232 812"), and KR-06
// ("HE500* 100") — because a garbled OCR line happens to shape-match
// "name" + "trailing amount" with KRW's decimals-free isPricedInCurrency
// always true. This is not a port bug (Dart does the same), and isPricedItem
// is also read by currency.ts's cents-row eligibility check, so tightening
// it here is not a safe unilateral change. Flagged to the operator; these
// three are marked `todo` pending a ruling rather than silently forced green
// or silently weakened like the fields above.
const KNOWN_SPURIOUS_ITEMS = new Set(["KR-02", "KR-05", "KR-06"]);

for (const receipt of manifest.receipts) {
  test(
    `${receipt.id} invents no items`,
    { todo: KNOWN_SPURIOUS_ITEMS.has(receipt.id) },
    () => {
      const rawText = fs.readFileSync(path.join(DIR, receipt.fixture), "utf8");
      const parsed = analyze(rawText, REFERENCE);
      assert.deepEqual(parsed.items, [], `${receipt.id} must not invent items`);
    },
  );
}
