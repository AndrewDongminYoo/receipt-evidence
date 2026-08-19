// Ported from due_back/lib/due_back/service/receipt_analyzer.dart:38-58
// (_nonMerchandiseLabel, _nonItemLabel, _namedItem), :188-190 (itemNameFrom),
// :251-258 (_isPricedItem), :285-289 (_isPricedInCurrency), and the
// itemCandidates block at :116-135.
//
// The corpus proves this path derives nothing on all 12 real receipts: item
// names do not survive OCR there. That is expected — it is the reason the
// system has an LLM step at all. This still works on cleaner receipts and is
// what verifies the model's items later.
import type { Currency } from "./types.ts";
import type { OcrEvidence } from "./evidence.ts";
import { parseDate } from "./dates.ts";
import { parseAmountMinor, withoutDateOrTime } from "./amounts.ts";

/** A priced line item and the evidence its name and amount came from. */
export interface ParsedItem {
  name: string;
  amountMinor: number;
  nameEvidence: OcrEvidence;
  amountEvidence: OcrEvidence;
}

// Settlement and column-header rows print a price like an item does, so they
// are matched at the start of the line where such a label always sits:
// `OIL CHANGE 39.99` is merchandise, `CHANGE DUE 7.01` and `QTY 1.00` are
// not.
const NON_MERCHANDISE_LABEL =
  /^((tender|change|balance|due|amount|payment|paid|auth|approval|cash|visa|mastercard|debit|credit|qty|quantity)\b|현금|수량|개수|거스름|잔액|받은\s*금액|승인)/i;
const NON_ITEM_LABEL =
  /(total|subtotal|discount|tax|vat|card|cash|visa|mastercard|합계|결제금액|소계|할인|세금|카드|현금)/i;
// An item needs a name, and `2@ 2.05` or `$ 41.00` leaves only punctuation
// once its trailing price is removed.
const NAMED_ITEM = /[A-Za-zㄱ-힝]/;
// receipt_analyzer.dart:36-39. Duplicated privately here rather than
// exported from amounts.ts — same precedent as currency.ts's private
// TRAILING_AMOUNT copy: one Dart static field, several TS-module-private
// copies, to avoid widening a module's export surface for a few-line regex.
const REFERENCE_LABEL = /(order|reference|주문번호|승인번호)/i;
// A receipt may mark its amount with a symbol or an ISO code, and a row
// naming something other than money never ends with one preceded by
// whitespace. Duplicated from currency.ts's private copy, same reason.
const TRAILING_AMOUNT = /\s+(?:(?:KRW|USD)\s*)?[₩$]?\s*(\d[\d,]*(?:\.\d{2})?)원?\s*$/i;
const CENTS_AMOUNT = /\d\.\d{2}(?!\d)/;

/** Strips the trailing amount off `evidence.text`, leaving the item's name. */
function itemNameFrom(evidence: OcrEvidence): string {
  return evidence.text.replace(TRAILING_AMOUNT, "").trim();
}

/** Whether `evidence` is a priced line item rather than a total, a
 * settlement row, a date, or a reference number.
 *
 * Exported so currency.ts's cents-row eligibility check
 * (receipt_analyzer.dart:400) can OR this in alongside isAmountOnlyRow,
 * matching Dart's `_isAmountOnlyRow(text) || _isPricedItem(line)` — the half
 * Task 6 left unported pending this module's existence. */
export function isPricedItem(evidence: OcrEvidence): boolean {
  return (
    !NON_ITEM_LABEL.test(evidence.text) &&
    !NON_MERCHANDISE_LABEL.test(evidence.text) &&
    parseDate(evidence.text) === null &&
    !REFERENCE_LABEL.test(evidence.text) &&
    TRAILING_AMOUNT.test(evidence.text) &&
    NAMED_ITEM.test(itemNameFrom(evidence))
  );
}

/** Whether the price on `line` can be an item price in `currency`.
 *
 * A cents currency prints them: `$12.99` is a price, while the `64118` of a
 * postal code, a store number, or an approval code is not. KRW has no minor
 * unit, so every amount there qualifies. */
function isPricedInCurrency(line: string, currency: Currency): boolean {
  if (currency === "KRW") return true;
  const match = TRAILING_AMOUNT.exec(withoutDateOrTime(line));
  return match !== null && CENTS_AMOUNT.test(match[1]);
}

/** Extracts priced line items in reading order, each paired with the
 * evidence line its name and amount came from. */
export function extractItems(lines: OcrEvidence[], currency: Currency): ParsedItem[] {
  return lines
    .filter(isPricedItem)
    .filter((line) => isPricedInCurrency(line.text, currency))
    .map((evidence) => ({
      name: itemNameFrom(evidence),
      amountMinor: parseAmountMinor(evidence.text, currency) ?? 0,
      nameEvidence: evidence,
      amountEvidence: evidence,
    }));
}
