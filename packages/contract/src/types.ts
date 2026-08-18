/** Currencies the corpus actually contains. Widen only with a fixture to prove it. */
export type Currency = "KRW" | "USD";

/** Money is always integer minor units — KRW won, USD cents. Never a float. */
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Money>;
  return (
    Number.isInteger(candidate.amountMinor) &&
    (candidate.currency === "KRW" || candidate.currency === "USD")
  );
}
