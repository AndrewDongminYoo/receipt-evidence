export interface ArithmeticCheck {
  itemSumMinor: number | null;
  claimedTotalMinor: number | null;
  /** A separately labelled tender that exactly closes the item/paid-total gap. */
  reconciledTenderMinor: number | null;
  /** null when the question cannot be asked — an absent answer is not agreement. */
  agrees: boolean | null;
}

export function checkArithmetic(
  items: readonly { amountMinor: number }[],
  claimedTotalMinor: number | null,
  additionalTenderMinor: readonly number[] = [],
): ArithmeticCheck {
  const itemSumMinor = items.length > 0 ? items.reduce((sum, item) => sum + item.amountMinor, 0) : null;
  if (itemSumMinor === null || claimedTotalMinor === null) {
    return { itemSumMinor, claimedTotalMinor, reconciledTenderMinor: null, agrees: null };
  }

  if (itemSumMinor === claimedTotalMinor) {
    return { itemSumMinor, claimedTotalMinor, reconciledTenderMinor: null, agrees: true };
  }

  const tenderSum = additionalTenderMinor.reduce((sum, amountMinor) => sum + amountMinor, 0);
  const reconciledTenderMinor = tenderSum > 0 && itemSumMinor === claimedTotalMinor + tenderSum ? tenderSum : null;
  return { itemSumMinor, claimedTotalMinor, reconciledTenderMinor, agrees: reconciledTenderMinor !== null };
}
