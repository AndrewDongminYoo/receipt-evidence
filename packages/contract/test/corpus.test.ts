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

// Ruling 5 (superseding the original "quotes a real line" check): a reviewer
// reverted the KR-04 merchant sign fix and reran this suite — zero
// failures, because "the evidence is some real line" accepts any line the
// parser happens to pick, including the exact regression this task fixed.
// A gate that cannot fail is the thing this repository argues against, so
// every non-derivable field the parser nonetheless populates is pinned to
// its exact current value below. These values are wrong (the manifest says
// so) and known to be wrong; the assertion exists so that a change to the
// parser's output here — a fix or a regression — shows up as a failing
// test instead of passing silently. See docs/notes/corpus-baseline.md.
const WRONG_MERCHANTS: Record<string, { value: string; evidence: string }> = {
  "KR-01": { value: "ELEUE", evidence: "ELEUE" },
  "KR-03": { value: "0|05 9 : (12)3456-7890", evidence: "0|05 9 : (12)3456-7890" },
  "KR-04": { value: "I21E", evidence: "I21E" },
  "KR-06": { value: "ЛЮТ9: 123-45-67890", evidence: "ЛЮТ9: 123-45-67890" },
  "EN-05": { value: "not saleps", evidence: "not saleps" },
};
const WRONG_PAID_TOTALS: Record<string, { value: number; evidence: string }> = {
  "KR-02": { value: 2345678901, evidence: "2345678901" },
  "KR-03": { value: 7890123456789, evidence: "7890123456789" },
  "KR-05": { value: 5678901234567, evidence: "5678901234567" },
  "KR-06": { value: 8901234567890, evidence: "8901234567890" },
  "EN-05": { value: 78901234567890, evidence: "Cashier: 78901234567890" },
};

for (const receipt of manifest.receipts) {
  test(`${receipt.id} extracts only OCR-supported facts`, () => {
    const rawText = fs.readFileSync(path.join(DIR, receipt.fixture), "utf8");
    const parsed = analyze(rawText, REFERENCE);
    const derived = receipt.ocrDerived;
    const lineTexts = parsed.lines.map((line: { text: string }) => line.text);

    if (derived.merchant.derivable === false) {
      const wrong = WRONG_MERCHANTS[receipt.id];
      if (wrong === undefined) {
        assert.equal(parsed.merchant, null, `${receipt.id} must not invent a merchant`);
      } else {
        assert.equal(parsed.merchant?.value, wrong.value, receipt.id);
        assert.equal(parsed.merchant?.evidence.text, wrong.evidence, receipt.id);
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
      const wrong = WRONG_PAID_TOTALS[receipt.id];
      if (wrong === undefined) {
        assert.equal(parsed.paidTotal, null, `${receipt.id} must not invent a total`);
      } else {
        assert.equal(parsed.paidTotal?.value, wrong.value, receipt.id);
        assert.equal(parsed.paidTotal?.evidence.text, wrong.evidence, receipt.id);
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
// for this field is the strict one — assert exactly what the parser
// returns, correct or not.
//
// extractItems is a faithful port of receipt_analyzer.dart:251-258/:285-289
// (verified line-for-line against the Dart source): on three of the twelve
// real fixtures a garbled OCR line shape-matches "name" + "trailing amount"
// and produces a spurious item — Dart's own algorithm does the same, so
// this is not a port bug. isPricedItem also feeds currency.ts's cents-row
// eligibility check (currently 12/12 correct), so narrowing the predicate
// here is not a safe unilateral change. Ruling: keep the faithful port and
// pin the wrong-but-measured output, so any future narrowing of the shared
// predicate shows up here as a failing assertion instead of a silent
// behaviour change. See docs/notes/corpus-baseline.md.
const SPURIOUS_ITEMS: Record<string, { name: string; amountMinor: number; evidence: string }> = {
  "KR-02": { name: "NO:", amountMinor: 34567, evidence: "NO: 34567" },
  "KR-05": { name: "X118/232", amountMinor: 812, evidence: "X118/232 812" },
  "KR-06": { name: "HE500*", amountMinor: 100, evidence: "HE500* 100" },
};

for (const receipt of manifest.receipts) {
  test(`${receipt.id} items`, () => {
    const rawText = fs.readFileSync(path.join(DIR, receipt.fixture), "utf8");
    const parsed = analyze(rawText, REFERENCE);
    const spurious = SPURIOUS_ITEMS[receipt.id];

    if (spurious === undefined) {
      assert.deepEqual(parsed.items, [], `${receipt.id} must not invent items`);
      return;
    }

    assert.equal(parsed.items.length, 1, receipt.id);
    assert.equal(parsed.items[0].name, spurious.name, receipt.id);
    assert.equal(parsed.items[0].amountMinor, spurious.amountMinor, receipt.id);
    assert.equal(parsed.items[0].nameEvidence.text, spurious.evidence, receipt.id);
  });
}
