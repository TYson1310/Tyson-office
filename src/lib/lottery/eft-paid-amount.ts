function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

export function normalizeOptionalLotteryEftPaidAmount(
  value: number | string | null | undefined,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = normalizeMoney(value);
  return normalized >= 0 ? normalized : null;
}

export function calculateAppliedLotteryEftPayment(input: {
  netEftDue: number | string | null | undefined;
  paidAmount: number | string | null | undefined;
}) {
  return (
    normalizeOptionalLotteryEftPaidAmount(input.paidAmount) ??
    normalizeMoney(input.netEftDue)
  );
}
