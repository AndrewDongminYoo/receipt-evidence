// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:59-87
// (constants), :192-198 (amountFrom, canUseAsAmount), and :441-470
// (_amountOf, _minorUnits, _withoutDateOrTime) — the substantive
// amount-parsing logic lives at :441-470, not inside the :192-244 range the
// task brief cited for it.
import type { Currency } from "./types.ts";
import type { OcrEvidence } from "./evidence.ts";
import { DATE_PATTERN_G, parseDate } from "./dates.ts";

// Exported so total.ts can test a row's shape (amount-only vs label+amount)
// without redeclaring this pattern — see DATE_PATTERN_G's precedent in
// dates.ts. `g`-flagged: safe with matchAll/replace only, per that same note.
export const AMOUNT_PATTERN_G = /\d[\d,]*(?:\.\d{2})?/g;
// Clock times ride the same line as dates on receipts; a colon never appears
// in an amount, so stripping `14:30:22` keeps it out of amount inference.
const CLOCK_TIME = /\d{1,2}:\d{2}(?::\d{2})?/g;
const SPLIT_GROUPING = /(\d),\s+(?=\d)/g;
const MAX_WHOLE_DIGITS = 15;
// receipt_analyzer.dart:36-39.
const REFERENCE_LABEL = /(order|reference|주문번호|승인번호)/i;

/** A date or clock time is not money: `2026.07.02` otherwise parses as
 * `202607`, and `14:30:22` injects phantom `14`/`30`/`22` amounts.
 *
 * OCR also splits a thousands separator from its digits, so `1, 700` is
 * rejoined before parsing rather than read as `700`. */
export function withoutDateOrTime(line: string): string {
  return line
    .replace(DATE_PATTERN_G, " ")
    .replace(CLOCK_TIME, " ")
    .replace(SPLIT_GROUPING, "$1,");
}

function minorUnits(amount: string): number | null {
  const parts = amount.replace(/,/g, "").split(".");
  const whole = parts[0];
  // Dart's _minorUnits guards with `int.tryParse(parts.first) == null` before
  // the length check. This port drops that guard: `amount` only ever reaches
  // here as an AMOUNT_PATTERN_G match (`\d[\d,]*(?:\.\d{2})?`), so `whole` is
  // always digit characters and `Number(whole)` can never be NaN.
  // A longer run is an identifier, not money, and scaling one to minor units
  // would wrap silently.
  if (whole.length > MAX_WHOLE_DIGITS) return null;
  if (parts.length === 1) return Number(whole);
  return Number(whole) * 100 + Number(parts[1]);
}

/** Every amount on `line`, in minor currency units, in the order printed.
 * Digit runs too long to be money, such as barcodes, are skipped rather than
 * scaled — the same skip `amountOf` has always made, factored out so the
 * evidence guard can ask "is this value one of the amounts on that line?"
 * using the parser's own reading of what an amount is. Any other tokenizer
 * would let the guard and the parser disagree about the same line. */
export function amountsOnLine(line: string): number[] {
  const amounts: number[] = [];
  for (const match of withoutDateOrTime(line).matchAll(AMOUNT_PATTERN_G)) {
    const parsed = minorUnits(match[0]);
    if (parsed !== null) amounts.push(parsed);
  }
  return amounts;
}

/** Returns the last amount on `line` in minor currency units, or `null` when
 * the line carries none. Dart's `_amountOf` keeps the last match, so this
 * reads the tail of `amountsOnLine` rather than re-scanning. */
function amountOf(line: string): number | null {
  const amounts = amountsOnLine(line);
  return amounts.length === 0 ? null : (amounts[amounts.length - 1] as number);
}

// `currency` is part of the ported signature but, like the Dart source,
// minor-unit scaling is decided by whether the matched token has a decimal
// part, never by currency — see minorUnits above.
export function parseAmountMinor(text: string, _currency: Currency): number | null {
  return amountOf(text);
}

export function canUseAsAmount(line: OcrEvidence): boolean {
  return (
    parseDate(line.text) === null &&
    !REFERENCE_LABEL.test(line.text) &&
    (amountOf(line.text) ?? 0) > 0
  );
}
