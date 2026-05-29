export function roundLotteryCashAdvanceMoney(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

export function calculateLotteryCashAdvanceImpact(input: {
  advancesTaken: number;
  paybacksReceived: number;
}) {
  return roundLotteryCashAdvanceMoney(
    input.paybacksReceived - input.advancesTaken,
  );
}
