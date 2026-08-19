// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:89-175
// (analyze) and :517-522 (_parseReference). Does NOT port :160-164's
// confidence score — that existed for due_back's own UI; this system reports
// verification instead, and a confidence number would invite exactly the
// "looks trustworthy" reading the project exists to prevent. Also does not
// port :128-151's synthetic fallback item (a "Purchase" line priced at the
// total when no item candidates survive) — that is a guess, and this system
// leaves a field null rather than guessing it.
import type { Currency } from "./types.ts";
import { evidenceLines, type OcrEvidence } from "./evidence.ts";
import { selectDate, parseDate } from "./dates.ts";
import { selectTotal } from "./total.ts";
import { parseAmountMinor, withoutDateOrTime, AMOUNT_PATTERN_G } from "./amounts.ts";
import { inferCurrency } from "./currency.ts";
import { extractItems, type ParsedItem } from "./items.ts";

export interface ParsedField<T> {
  value: T;
  evidence: OcrEvidence;
}

export interface ParsedReceipt {
  merchant: ParsedField<string> | null;
  purchaseDate: ParsedField<Date> | null;
  paidTotal: ParsedField<number> | null; // minor units
  currency: Currency;
  reference: ParsedField<string> | null;
  items: ParsedItem[];
  lines: OcrEvidence[];
}

// receipt_analyzer.dart:38-41. Duplicated privately here rather than
// exported from amounts.ts — same precedent as items.ts's and currency.ts's
// own private copies of this same label.
const REFERENCE_LABEL = /(order|reference|주문번호|승인번호)/i;
// receipt_analyzer.dart:519. Case-sensitive in Dart (no `caseSensitive:
// false`), so this stays without an `i` flag: a reference token is
// upper-cased digits/letters/hyphens, at least 4 chars, at the end of the
// line.
const REFERENCE_PATTERN = /[A-Z0-9][A-Z0-9-]{3,}$/;

function parseReference(text: string): string | null {
  const match = REFERENCE_PATTERN.exec(text);
  const reference = match?.[0] ?? null;
  return reference !== null && /\d/.test(reference) ? reference : null;
}

// Total selection runs before currency inference (the cycle Task 6's own
// comment in total.ts documents), so it is threaded a provisional currency.
// parseAmountMinor never actually reads its currency argument — see
// amounts.ts — so any value works here.
const PROVISIONAL_CURRENCY: Currency = "KRW";

// receipt_analyzer.dart:471-480 (_largestAmount): the fallback total for a
// receipt with no TOTAL_LABEL row. Unlike parseAmountMinor (which keeps only
// the LAST amount on a line), this scans every matched amount on every line
// and keeps the largest, matching Dart's per-match comparison. Ties keep the
// first occurrence (strict `>`, lines then matches in order).
function largestAmount(lines: OcrEvidence[]): ParsedField<number> | null {
  let best: ParsedField<number> | null = null;
  for (const line of lines) {
    for (const match of withoutDateOrTime(line.text).matchAll(AMOUNT_PATTERN_G)) {
      const value = parseAmountMinor(match[0], PROVISIONAL_CURRENCY);
      if (value !== null && (best === null || value > best.value)) {
        best = { value, evidence: line };
      }
    }
  }
  return best;
}

/** Runs the deterministic parser end to end: lines, date, total, reference,
 * amount, currency, items, merchant — the order `receipt_analyzer.dart:89-175`
 * calls them in. A field is `null` whenever the parser cannot derive it;
 * `null` is the signal that hands that field to the model later, so no field
 * here is ever defaulted or guessed. */
export function analyze(rawText: string, referenceDate: Date): ParsedReceipt {
  const lines = evidenceLines(rawText);

  const dateEvidence = selectDate(lines, referenceDate);
  const purchaseDate: ParsedField<Date> | null =
    dateEvidence === null
      ? null
      : // selectDate only returns a line for which parseDate already
        // succeeded, so this second parse cannot fail.
        { value: parseDate(dateEvidence.text) as Date, evidence: dateEvidence };

  const totalEvidence = selectTotal(lines, PROVISIONAL_CURRENCY);

  const referenceEvidence =
    lines.find((line) => REFERENCE_LABEL.test(line.text) && parseReference(line.text) !== null) ??
    null;
  const reference: ParsedField<string> | null =
    referenceEvidence === null
      ? null
      : { value: parseReference(referenceEvidence.text) as string, evidence: referenceEvidence };

  const paidTotal: ParsedField<number> | null =
    totalEvidence === null
      ? largestAmount(lines)
      : ((): ParsedField<number> | null => {
          const value = parseAmountMinor(totalEvidence.text, PROVISIONAL_CURRENCY);
          return value === null ? null : { value, evidence: totalEvidence };
        })();

  const currency = inferCurrency(rawText, lines, totalEvidence);

  const items = extractItems(lines, currency);

  // receipt_analyzer.dart:154/:167 — merchant is unconditionally the first
  // recognised line (`lines.first`), with no filter for amount/date shape.
  // The `.skip(1)` at :129, in the unrelated synthetic-fallback-item block
  // this module does not port, confirms line 0 is reserved for the merchant
  // elsewhere in that function.
  const merchant: ParsedField<string> | null =
    lines.length === 0 ? null : { value: lines[0].text, evidence: lines[0] };

  return { merchant, purchaseDate, paidTotal, currency, reference, items, lines };
}
