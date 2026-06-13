export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizePositivePackSize(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }

  return normalized;
}

export function normalizeNonNegativeCurrency(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }

  return roundCurrency(normalized);
}

export function calculateUnitAmountForPackSizeChange(
  unitAmount: unknown,
  previousItemsPerPack: unknown,
  nextItemsPerPack: unknown,
) {
  const amount = normalizeNonNegativeCurrency(unitAmount);
  const previousPackSize = normalizePositivePackSize(previousItemsPerPack);
  const nextPackSize = normalizePositivePackSize(nextItemsPerPack);

  if (amount === null || previousPackSize === null || nextPackSize === null) {
    return null;
  }

  return roundCurrency((amount * previousPackSize) / nextPackSize);
}

export function calculateSellingPriceForMargin(
  cost: unknown,
  marginPercent: unknown,
) {
  const normalizedCost = normalizeNonNegativeCurrency(cost);
  const normalizedMargin =
    typeof marginPercent === "number"
      ? marginPercent
      : typeof marginPercent === "string"
        ? Number(marginPercent)
        : Number.NaN;

  if (
    normalizedCost === null ||
    normalizedCost <= 0 ||
    !Number.isFinite(normalizedMargin) ||
    normalizedMargin < 0 ||
    normalizedMargin > 95
  ) {
    return null;
  }

  return roundCurrency(normalizedCost / (1 - normalizedMargin / 100));
}
