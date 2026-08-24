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
import { selectTotal, isAmountOnlyRow } from "./total.ts";
import { parseAmountMinor, withoutDateOrTime, AMOUNT_PATTERN_G } from "./amounts.ts";
import { inferCurrency } from "./currency.ts";
import { extractItems, type ParsedItem } from "./items.ts";
import { extractTenders, type ParsedTender } from "./tenders.ts";

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
  tenders: ParsedTender[];
  lines: OcrEvidence[];
}

// receipt_analyzer.dart:38-41. Duplicated privately here rather than
// exported from amounts.ts — same precedent as items.ts's own private copy
// of this same label (amounts.ts's own copy is likewise unexported). Not
// currency.ts: Dart's `_currencyFrom` never consults `_referenceLabel`, so
// currency.ts has no copy of this pattern.
// Letter-spacing tolerated — see TOTAL_LABEL in total.ts.
const REFERENCE_LABEL = /(order|reference|주\s*문\s*번\s*호|승\s*인\s*번\s*호)/i;
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
  const tenders = extractTenders(lines, currency);

  // Deliberate deviation from receipt_analyzer.dart:154/:167, which takes
  // `lines.first` unconditionally with no amount/date filter. Dart's
  // merchant feeds an app that shows the value to its own user, who can see
  // at a glance that it is wrong; this system's contract instead ships
  // every value with evidence a reader is invited to trust, so `lines.first`
  // alone would let a rotated scan (the corpus's KR-04, whose manifest
  // reason is "the rotated scan starts with amount lines") publish an
  // amount as the merchant name, backed by an amount line, presented as a
  // fact it cannot support. The filter stays narrow on purpose — skip a
  // line only when it parses as a date or is nothing but an amount, never a
  // heuristic about what a merchant name looks like: a garbled brand mark
  // (the corpus's KR-01, "ELEUE") must still come through, because it is
  // honestly what line 0 says and no rule can tell it apart from a real one.
  //
  // "amount" includes a signed one: isAmountOnlyRow itself doesn't strip a
  // leading +/-, which is correct for its other callers (total.ts,
  // currency.ts — measured 12/12 correct on the corpus) but let KR-04's
  // "-1,167" line through here as a merchant name. The sign is stripped
  // locally instead of widening isAmountOnlyRow's own definition.
  const isSignedAmountOnlyRow = (text: string): boolean =>
    isAmountOnlyRow(text.replace(/^[+-]\s*/, ""));
  const merchantEvidence =
    lines.find((line) => parseDate(line.text) === null && !isSignedAmountOnlyRow(line.text)) ??
    null;
  const merchant: ParsedField<string> | null =
    merchantEvidence === null ? null : { value: merchantEvidence.text, evidence: merchantEvidence };

  return { merchant, purchaseDate, paidTotal, currency, reference, items, tenders, lines };
}
