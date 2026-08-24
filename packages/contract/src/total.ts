// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:18-37
// (_totalLabel, _otherAmountLabel, _countLabel), :65-79 (_namedItem,
// _currencySymbol, _wonMarker, _dollarMarker), :87 (_splitTotalLookahead),
// and :207-356 (_isSplitTotalValue, _isAmountOnlyRow, _splitTotalValueAfter,
// _totalEvidenceOf, _columnAlignedValue, _isLabelRow, _labeledAmount,
// _currencyMarkedEvidence, _namesAnotherFigure).
import type { Currency } from "./types.ts";
import type { OcrEvidence } from "./evidence.ts";
import { parseAmountMinor, withoutDateOrTime, AMOUNT_PATTERN_G } from "./amounts.ts";

// Exported: currency.ts (Task 6) ports `_splitLabelCurrency`, which tests
// this same label against the rows above a split total. Dart holds one copy
// as a static field; two TS copies would be the thing that diverges.
// Korean receipt printers letter-space their labels — the device pass on a
// 7-Eleven receipt printed `합 계`, not `합계`, and `부 가 세` beside it. A
// label that misses is not a near-miss: `selectTotal` falls through to its
// largest-amount fallback, which on that receipt published the product
// BARCODE `4001686375754` as the paid total, verified, with a box drawn over
// it. The 12-receipt corpus never showed this because its Korean fixtures
// happen to print theirs tight.
//
// A deliberate deviation from the Dart source, which has the same patterns:
// this system's contract is that a value ships with evidence a reader can
// check, and a barcode presented as a total is exactly what that exists to
// prevent. Latin labels are left alone — OCR does not letter-space them.
export const TOTAL_LABEL = /(^|\s)(total|grand total|결\s*제\s*금\s*액|합\s*계)(\s|:|$)/i;
// A row naming a different money figure is never the paid total. The English
// labels match as whole words, so `TAXI FARE $12.99` is a fare rather than a
// tax row; the Korean ones match anywhere, because `할인금액` is one word.
// Exported: currency.ts reuses this to exclude a fare/tax row from marker
// detection, same reuse reason as TOTAL_LABEL above.
// Letter-spacing tolerated for the same reason as TOTAL_LABEL above.
export const OTHER_AMOUNT_LABEL = /\b(discount|saved|savings?|tax|vat|subtotal)\b|소\s*계|할\s*인|세\s*금|부\s*가\s*세/i;
// A row naming a count is the paid total only when it also carries money:
// `TOTAL 2 ITEMS $24.95` is a total, `TOTAL NUMBER OF ITEMS SOLD - 10` is a tally.
const COUNT_LABEL = /\b(count|number|items?|sold|qty|quantity)\b|수량|개수/i;
// Exported: currency.ts's `_splitLabelCurrency` port reuses the same lookahead.
export const SPLIT_TOTAL_LOOKAHEAD = 2;

// An item needs a name, and `2@ 2.05` or `$ 41.00` leaves only punctuation
// once its trailing price is removed.
const NAMED_ITEM = /[A-Za-zㄱ-힝]/;
// A receipt may mark its amount with a symbol or an ISO code, and the
// fallback total must cite either one as evidence.
// Non-global: `.test()`-only. A `g`-flagged twin is kept separately for the
// `.replace()` call in isAmountOnlyRow — see DATE_PATTERN_G's note in
// dates.ts on why a `g` regex must not be shared across both uses.
// `#` directly before a digit is a won glyph: Korean thermal printers without
// a ₩ in their font print `합계  #2,000`, and the 7-Eleven capture does. It is
// deliberately narrow — `#` alone, or before a letter, is an item or store
// number (`뚝섬리버빌점#19345`), and only the digit lookahead keeps those out.
// A line that is nothing but `#19345` would still read as an amount; no
// receipt seen prints one, and the alternative is failing to read the total
// on every printer of this kind.
const CURRENCY_SYMBOL = /[₩$]|#(?=\d)|원|\b(KRW|USD)\b/i;
const CURRENCY_SYMBOL_G = /[₩$]|#(?=\d)|원|\b(KRW|USD)\b/gi;
// `원` is a currency only where it follows an amount: `12,900원` is money,
// `원두커피` is coffee.
// Exported: currency.ts's marker checks are the same static fields Dart
// declares once (`_wonMarker`, `_dollarMarker`).
export const WON_MARKER = /₩|\bKRW\b|\d\s*원/i;
export const DOLLAR_MARKER = /(\$|USD)/i;

/** Whether `line` holds an amount and nothing else once its date, clock time,
 * and currency marker are removed.
 *
 * Exported: currency.ts's `_currencyFrom` port calls this same check
 * (receipt_analyzer.dart:213-219 is one static method, not two). */
export function isAmountOnlyRow(line: string): boolean {
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
  // Positional pairing assumes the labels and the values came out in the same
  // order, and OCR does not guarantee it. On the 7-Eleven capture Vision put
  // the big bold `합계` ABOVE the `부  가  세` row it sits below on paper, so
  // the run read [합계, 부 가 세] against values [182, #2,000] and the VAT
  // shipped as the paid total.
  //
  // A currency glyph is the receipt's own answer to which number is the
  // total: the subtotal and the tax print bare, the total gets the ₩ or the
  // #. When exactly one value in the column carries one, it is the total
  // whatever order the labels landed in. Exactly one, because a receipt that
  // marks every value tells us nothing by marking them — that falls through
  // to pairing, which is what the stacked `SUBTOTAL:/TAX:/TOTAL:` block over
  // bare `5.50/0.53/6.03` needs. This is the same belief currencyMarkedEvidence
  // already encodes as the last resort, applied one level earlier.
  const marked = values.filter((value) => CURRENCY_SYMBOL.test(value.text));
  if (marked.length === 1) return marked[0] as OcrEvidence;
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
      // A line carrying no amount that NAMES a figure claims the value after
      // it, so walking past hands our label someone else's number. Measured on
      // a 7-Eleven capture: Vision's reading order put the big bold `합계`
      // above the `부  가  세` row, the lookahead stepped over that label, and
      // the VAT's 182 shipped as the paid total with `"182"` as its evidence.
      if (namesAnotherFigure(line.text) || TOTAL_LABEL.test(line.text)) return null;
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
