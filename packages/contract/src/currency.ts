// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:69-80
// (WON_MARKER, DOLLAR_MARKER, CENTS_AMOUNT, TRAILING_AMOUNT) and :365-425
// (_currencyFrom, _splitLabelCurrency). TOTAL_LABEL, OTHER_AMOUNT_LABEL,
// SPLIT_TOTAL_LOOKAHEAD, WON_MARKER, DOLLAR_MARKER, and isAmountOnlyRow are
// imported from total.ts rather than redeclared — see the "Exported" notes
// there.
//
// One piece of Dart's `_currencyFrom` (:400) is NOT ported: the cents-row
// eligibility check there is `_isAmountOnlyRow(text) || _isPricedItem(line)`,
// and `_isPricedItem` depends on `_nonItemLabel`/`_nonMerchandiseLabel`/
// `_namedItem`/`itemNameFrom`, which live in items.ts (Task 7) and do not
// exist yet at this point in the task order. This TS port only accepts
// amount-only rows into the cents count, which is STRICTER than Dart —
// fewer rows qualify, biasing toward KRW exactly where Dart could still
// reach USD via a priced-item row. The risk is bounded: Task 7's own brief
// states the item-name path derives nothing on all 12 real corpus receipts
// (names do not survive OCR), so the omitted OR-branch is inert on the
// corpus gate (Task 9). Pinned by the fourth test in currency.test.ts.
import type { Currency } from "./types.ts";
import type { OcrEvidence } from "./evidence.ts";
import { withoutDateOrTime } from "./amounts.ts";
import {
  TOTAL_LABEL,
  OTHER_AMOUNT_LABEL,
  SPLIT_TOTAL_LOOKAHEAD,
  WON_MARKER,
  DOLLAR_MARKER,
  isAmountOnlyRow,
} from "./total.ts";

// `원` is a currency only where it follows an amount: `12,900원` is money,
// `원두커피` is coffee. (WON_MARKER/DOLLAR_MARKER themselves live in total.ts.)
const CENTS_AMOUNT = /\d\.\d{2}(?!\d)/;
// A receipt may mark its amount with a symbol or an ISO code, and a row
// naming something other than money (an approval code, a quantity) never
// ends with one preceded by whitespace.
const TRAILING_AMOUNT = /\s+(?:(?:KRW|USD)\s*)?[₩$]?\s*(\d[\d,]*(?:\.\d{2})?)원?\s*$/i;

/** Only a row that is an amount and nothing else may imply cents. A quantity
 * or weight such as `QTY 1.00 kg` shares the shape but not the meaning, and
 * reading it as a currency marker would price a won receipt in dollars with
 * no way for the reviewer to correct it. */
function impliesCents(line: string): boolean {
  return CENTS_AMOUNT.test(withoutDateOrTime(line));
}

/** A split total keeps its marker on the label row: `TOTAL USD` above a
 * value row whose decimal point OCR lost. */
function splitLabelCurrency(lines: OcrEvidence[], total: OcrEvidence): Currency | null {
  const start = total.lineIndex - 1;
  for (let index = start; index >= 0 && start - index <= SPLIT_TOTAL_LOOKAHEAD; index--) {
    const text = lines[index].text;
    if (!TOTAL_LABEL.test(text)) continue;
    if (WON_MARKER.test(text)) return "KRW";
    if (DOLLAR_MARKER.test(text)) return "USD";
    return null;
  }
  return null;
}

/** Infers the receipt's currency from its markers.
 *
 * `rawText` is part of the ported signature but, like Dart's
 * `_currencyFrom`, is never read by the body. */
export function inferCurrency(_rawText: string, lines: OcrEvidence[], total: OcrEvidence | null): Currency {
  if (total !== null) {
    const text = total.text;
    if (WON_MARKER.test(text)) return "KRW";
    if (DOLLAR_MARKER.test(text) || impliesCents(text)) return "USD";
    // A split total keeps its marker on the label row: `TOTAL USD` above a
    // value row whose decimal point OCR lost.
    const labelled = splitLabelCurrency(lines, total);
    if (labelled !== null) return labelled;
  }
  // A marker on an unrelated row — promotional copy, a store notice — says
  // nothing about this purchase, so only rows that are an amount and nothing
  // else are consulted when the total row itself is silent. One such row is
  // an anomaly, a quantity or a weight; a receipt priced in cents prints
  // them throughout, so two must agree.
  let centsRows = 0;
  for (const line of lines) {
    const text = line.text;
    // A row that ends with its amount is about money, whatever it is called:
    // `AMOUNT DUE $12.99` and `TENDER $20.00` both name this purchase's
    // currency even though neither may be quoted as its paid total.
    // Promotional copy such as `GET $5 OFF NEXT VISIT` does not end there,
    // and a row that names a saving, a discount, or a tax is not the
    // purchase either.
    const endsWithAmount = isAmountOnlyRow(text) || TRAILING_AMOUNT.test(text);
    if (endsWithAmount && !OTHER_AMOUNT_LABEL.test(text)) {
      if (WON_MARKER.test(text)) return "KRW";
      if (DOLLAR_MARKER.test(text)) return "USD";
    }
    if (!isAmountOnlyRow(text)) continue;
    if (!impliesCents(text)) continue;
    centsRows++;
    if (centsRows > 1) return "USD";
  }
  return "KRW";
}
