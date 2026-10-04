// Issue #10's 15-line OCR reproduction. The leading 1 and 100 belong to
// the last item row; neither is the payment amount at line 12.
export const COLUMN_PAYMENT_LINES = [
  "(*)면세상품 소계:", "노마진 소계:", "카", "드:", "-결제 수단 내역",
  "총수량:", "총합계:", "결제 금액:",
  "1", "100", "65, 455", "6.545", "72,000", "0", "0",
];

export const COLUMN_PAYMENT_TEXT = COLUMN_PAYMENT_LINES.join("\n");

// Values alone cannot establish the label mapping in this OCR layout.
export const AMBIGUOUS_PAYMENT_CASES = [
  { name: "original capture", text: COLUMN_PAYMENT_TEXT },
  {
    name: "a partial card payment after the ambiguous total",
    text: `${COLUMN_PAYMENT_TEXT}\n상품권 결제금액: 5,000\n신용카드 결제금액: 67,000원`,
  },
  {
    name: "changed total value",
    text: COLUMN_PAYMENT_LINES.map((line, index) => index === 12 ? "90" : line).join("\n"),
  },
  {
    name: "missing total replaced by a following section amount",
    text: [...COLUMN_PAYMENT_LINES.slice(0, 12), "99,999", "0", "0"].join("\n"),
  },
  {
    name: "missing subtotal and an inserted later amount",
    text: [...COLUMN_PAYMENT_LINES.slice(0, 10), ...COLUMN_PAYMENT_LINES.slice(11, 13), "99,999", "0", "0"].join("\n"),
  },
  ...["COMMENT", "PAYMENT DETAILS", "SHIPPING:"].map((heading) => ({
    name: `interleaved ${heading}`,
    text: [...COLUMN_PAYMENT_LINES.slice(0, 5), heading, ...COLUMN_PAYMENT_LINES.slice(5)].join("\n"),
  })),
  {
    name: "unknown shipping label and missing total",
    text: "SUBTOTAL\nTOTAL\nSHIPPING\nTAX\n5.50\n2.00\n0.53",
  },
  {
    name: "heading and trailing amount masking a missing total",
    text: "PAYMENT DETAILS\nSUBTOTAL\nTOTAL\nTAX\n5.50\n0.53\n10.00",
  },
  {
    name: "unrelated currency-marked trailing amount",
    text: "PAYMENT DETAILS\nSUBTOTAL\nTOTAL\nTAX\n5.50\n0.53\n$10.00",
  },
  ...["TOTAL (USD)", "TOTAL DUE"].map((label) => ({
    name: `unresolved ${label} and an unrelated trailing amount`,
    text: `PAYMENT DETAILS\nSUBTOTAL\n${label}\nTAX\n5.50\n0.53\n$10.00`,
  })),
];
