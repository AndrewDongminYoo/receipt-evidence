// Issue #10's 15-line OCR reproduction. The leading 1 and 100 belong to
// the last item row; neither is the payment amount at line 12.
export const COLUMN_PAYMENT_LINES = [
  "(*)면세상품 소계:", "노마진 소계:", "카", "드:", "-결제 수단 내역",
  "총수량:", "총합계:", "결제 금액:",
  "1", "100", "65, 455", "6.545", "72,000", "0", "0",
];

export const COLUMN_PAYMENT_TEXT = COLUMN_PAYMENT_LINES.join("\n");
