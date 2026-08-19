// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:18-37
// (_totalLabel, _otherAmountLabel, _countLabel), :65-79 (_namedItem,
// _currencySymbol, _wonMarker, _dollarMarker), :87 (_splitTotalLookahead),
// and :207-356 (_isSplitTotalValue, _isAmountOnlyRow, _splitTotalValueAfter,
// _totalEvidenceOf, _columnAlignedValue, _isLabelRow, _labeledAmount,
// _currencyMarkedEvidence, _namesAnotherFigure).
import type { Currency } from "./types.ts";
import type { OcrEvidence } from "./evidence.ts";
import { parseAmountMinor, withoutDateOrTime, AMOUNT_PATTERN_G } from "./amounts.ts";

const TOTAL_LABEL = /(^|\s)(total|grand total|결제금액|합계)(\s|:|$)/i;
// A row naming a different money figure is never the paid total. The English
// labels match as whole words, so `TAXI FARE $12.99` is a fare rather than a
// tax row; the Korean ones match anywhere, because `할인금액` is one word.
const OTHER_AMOUNT_LABEL = /\b(discount|saved|savings?|tax|vat|subtotal)\b|소계|할인|세금|부가세/i;
// A row naming a count is the paid total only when it also carries money:
// `TOTAL 2 ITEMS $24.95` is a total, `TOTAL NUMBER OF ITEMS SOLD - 10` is a tally.
const COUNT_LABEL = /\b(count|number|items?|sold|qty|quantity)\b|수량|개수/i;
const SPLIT_TOTAL_LOOKAHEAD = 2;

// An item needs a name, and `2@ 2.05` or `$ 41.00` leaves only punctuation
// once its trailing price is removed.
const NAMED_ITEM = /[A-Za-zㄱ-힝]/;
// A receipt may mark its amount with a symbol or an ISO code, and the
// fallback total must cite either one as evidence.
// Non-global: `.test()`-only. A `g`-flagged twin is kept separately for the
// `.replace()` call in isAmountOnlyRow — see DATE_PATTERN_G's note in
// dates.ts on why a `g` regex must not be shared across both uses.
const CURRENCY_SYMBOL = /[₩$]|원|\b(KRW|USD)\b/i;
const CURRENCY_SYMBOL_G = /[₩$]|원|\b(KRW|USD)\b/gi;
// `원` is a currency only where it follows an amount: `12,900원` is money,
// `원두커피` is coffee.
const WON_MARKER = /₩|\bKRW\b|\d\s*원/i;
const DOLLAR_MARKER = /(\$|USD)/i;

/** Whether `line` holds an amount and nothing else once its date, clock time,
 * and currency marker are removed. */
function isAmountOnlyRow(line: string): boolean {
  return withoutDateOrTime(line).replace(CURRENCY_SYMBOL_G, " ").replace(AMOUNT_PATTERN_G, " ").trim() === "";
}

/** Whether a line following a bare total label carries that total's value. */
function isSplitTotalValue(evidence: OcrEvidence, currency: Currency): boolean {
  return (parseAmountMinor(evidence.text, currency) ?? 0) > 0 && isAmountOnlyRow(evidence.text);
}

/** A label carries words and no amount. A separator row such as `****` is
 * neither, and counting it would shift every label off its value. */
function isLabelRow(line: string, currency: Currency): boolean {
  return parseAmountMinor(line, currency) === null && NAMED_ITEM.test(line);
}

/** Pairs a total label with its value when OCR flattens a two-column block.
 *
 * A receipt printing `SUBTOTAL:`, `TAX:`, `TOTAL:`, `VISA:` above `5.50`,
 * `0.53`, `6.03`, `6.03` yields the labels first and the amounts after, so
 * the nth label belongs to the nth amount. Taking the first amount below the
 * label would report the subtotal as the paid total. */
function columnAlignedValue(
  lines: OcrEvidence[],
  labelIndex: number,
  currency: Currency,
): OcrEvidence | null {
  let start = labelIndex;
  while (start > 0 && isLabelRow(lines[start - 1].text, currency)) {
    start--;
  }
  let end = labelIndex;
  while (end + 1 < lines.length && isLabelRow(lines[end + 1].text, currency)) {
    end++;
  }
  const labels = end - start + 1;
  if (labels < 2) return null;
  const values: OcrEvidence[] = [];
  for (let index = end + 1; index < lines.length; index++) {
    if (!isSplitTotalValue(lines[index], currency)) break;
    values.push(lines[index]);
  }
  if (values.length < labels) return null;
  return values[labelIndex - start];
}

/** Finds the value of a bare total label in the rows below it.
 *
 * OCR flattens a two-column total into consecutive rows and sometimes emits
 * a timestamp row in between, so rows carrying no amount are skipped within
 * a short window before the first row that does is tested. */
function splitTotalValueAfter(
  lines: OcrEvidence[],
  labelIndex: number,
  currency: Currency,
): OcrEvidence | null {
  const aligned = columnAlignedValue(lines, labelIndex, currency);
  if (aligned !== null) return aligned;
  let skipped = 0;
  for (
    let index = labelIndex + 1;
    index < lines.length && skipped <= SPLIT_TOTAL_LOOKAHEAD;
    index++
  ) {
    const line = lines[index];
    if (parseAmountMinor(line.text, currency) === null) {
      skipped++;
      continue;
    }
    return isSplitTotalValue(line, currency) ? line : null;
  }
  return null;
}

function labeledAmount(line: string, currency: Currency): number | null {
  const match = TOTAL_LABEL.exec(line);
  if (match === null) return null;
  return parseAmountMinor(line.slice(match.index + match[0].length), currency);
}

/** Whether `line` reports something other than the paid total.
 *
 * A count only disqualifies a row that carries no money: a receipt may
 * summarise its purchase as `TOTAL 2 ITEMS $24.95`. */
function namesAnotherFigure(line: string): boolean {
  if (OTHER_AMOUNT_LABEL.test(line)) return true;
  if (!COUNT_LABEL.test(line)) return false;
  return !WON_MARKER.test(line) && !DOLLAR_MARKER.test(line);
}

/** The last resort for a receipt with no total label: a row that is a
 * currency-marked amount and nothing else. Requiring the whole row keeps
 * `SUBTOTAL $20.00`, `TENDER $20.00`, and `TAX $1.05` out without having to
 * enumerate every label a receipt might print beside an amount. */
function currencyMarkedEvidence(lines: OcrEvidence[], currency: Currency): OcrEvidence | null {
  let marked: OcrEvidence | null = null;
  let largest = 0;
  for (const line of lines) {
    if (!CURRENCY_SYMBOL.test(line.text) || !isAmountOnlyRow(line.text)) continue;
    const amount = parseAmountMinor(line.text, currency);
    if (amount === null || amount <= largest) continue;
    largest = amount;
    marked = line;
  }
  return marked;
}

/** Selects the line carrying the paid total.
 *
 * Real receipts print the label and its value either on one line or in two
 * columns that OCR flattens into consecutive lines, so a label without a
 * value falls through to the following line. The returned evidence is always
 * the line the value came from. Receipts whose total survives only as a
 * currency-marked amount fall back to that line.
 *
 * `currency` is provisional here — total selection runs before currency
 * inference (Task 6), so this must not depend on a final currency decision.
 * It is threaded through only to satisfy parseAmountMinor's signature. */
export function selectTotal(lines: OcrEvidence[], currency: Currency): OcrEvidence | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!TOTAL_LABEL.test(line.text) || namesAnotherFigure(line.text)) {
      continue;
    }
    if (labeledAmount(line.text, currency) !== null) return line;
    const value = splitTotalValueAfter(lines, index, currency);
    if (value !== null) return value;
  }
  return currencyMarkedEvidence(lines, currency);
}
