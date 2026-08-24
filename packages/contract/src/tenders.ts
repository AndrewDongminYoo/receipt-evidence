import { AMOUNT_PATTERN_G, parseAmountMinor } from "./amounts.ts";
import type { OcrEvidence } from "./evidence.ts";
import type { Currency } from "./types.ts";

/** A deterministic, explicitly labelled payment contribution. */
export interface ParsedTender {
  amountMinor: number;
  evidence: OcrEvidence;
}

const TENDER_LABEL = /상품\s*권|gift\s*(?:card|certificate)|voucher|쿠폰|coupon|포인트/i;
const TENDER_BALANCE_LABEL = /\bbalance\b|잔액/i;
const TENDER_FUTURE_USE_LABEL =
  /\b(?:next|future)\s+(?:payment|use|purchase|order)\b|\b(?:valid|available)\b.*\b(?:payment|use|purchase|order)\b|사용\s*(?:가능|예정)|(?:다음|차후)\s*(?:결제|사용|구매|주문)/i;
const TENDER_PAYMENT_LABEL = /결제\s*금액|사용\s*금액|결제|사용|차감|\bpayment\b/i;
const TENDER_MARKED_AMOUNT_G = /(?:[$₩#]\s*|\b(?:KRW|USD)\s*)(\d[\d,]*(?:\.\d{2})?)/gi;

/** Whether a line names a non-card tender payment, rather than the tender itself. */
export function isTenderPaymentLine(text: string): boolean {
  return TENDER_LABEL.test(text) && TENDER_PAYMENT_LABEL.test(text);
}

/**
 * Finds only tender amounts whose own line identifies both a tender and a
 * payment action. A gift-certificate name or balance is not evidence that it
 * paid this receipt, so it is deliberately ignored.
 */
export function extractTenders(lines: readonly OcrEvidence[], currency: Currency): ParsedTender[] {
  const tenders: ParsedTender[] = [];
  for (const evidence of lines) {
    if (!isTenderPaymentLine(evidence.text) || TENDER_FUTURE_USE_LABEL.test(evidence.text)) continue;
    const paymentMatch = TENDER_PAYMENT_LABEL.exec(evidence.text);
    if (paymentMatch === null || TENDER_BALANCE_LABEL.test(evidence.text.slice(0, paymentMatch.index))) continue;
    const paymentTail = evidence.text.slice(paymentMatch.index + paymentMatch[0].length);
    const balanceMatch = TENDER_BALANCE_LABEL.exec(paymentTail);
    const amountTail = balanceMatch === null ? paymentTail : paymentTail.slice(0, balanceMatch.index);
    const markedAmounts = [...amountTail.matchAll(TENDER_MARKED_AMOUNT_G)];
    const unmarkedAmounts = [...amountTail.matchAll(AMOUNT_PATTERN_G)];
    const amountText = markedAmounts[0]?.[1] ?? unmarkedAmounts[unmarkedAmounts.length - 1]?.[0];
    const amountMinor = amountText === undefined ? null : parseAmountMinor(amountText, currency);
    if (amountMinor !== null && amountMinor > 0) tenders.push({ amountMinor, evidence });
  }
  return tenders;
}
