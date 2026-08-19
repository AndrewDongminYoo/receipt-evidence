export interface ArithmeticCheck {
  itemSumMinor: number | null;
  claimedTotalMinor: number | null;
  /** null when the question cannot be asked — an absent answer is not agreement. */
  agrees: boolean | null;
}

export function checkArithmetic(
  items: readonly { amountMinor: number }[],
  claimedTotalMinor: number | null,
): ArithmeticCheck {
  const itemSumMinor = items.length > 0 ? items.reduce((sum, item) => sum + item.amountMinor, 0) : null;
  const agrees =
    itemSumMinor === null || claimedTotalMinor === null ? null : itemSumMinor === claimedTotalMinor;
  return { itemSumMinor, claimedTotalMinor, agrees };
}
