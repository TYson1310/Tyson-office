function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

type LotteryAuditRevenueRow = {
  audit_type?: string | null;
  calculated_revenue?: number | string | null;
};

export function isLotteryEodAuditType(auditType: string | null | undefined) {
  return auditType === "eod";
}

export function calculateLotteryEodScratchSales(
  auditRows: LotteryAuditRevenueRow[],
) {
  return normalizeMoney(
    auditRows.reduce(
      (total, audit) =>
        isLotteryEodAuditType(audit.audit_type)
          ? total + normalizeMoney(audit.calculated_revenue)
          : total,
      0,
    ),
  );
}

export function calculateLotteryCashInHandFromReconciliation(input: {
  openingCashFloat?: number | string | null;
  posRegisterTotal?: number | string | null;
}) {
  return normalizeMoney(
    Math.max(
      normalizeMoney(input.posRegisterTotal) -
        normalizeMoney(input.openingCashFloat),
      0,
    ),
  );
}

export function applyLotteryCashAdvanceImpact(input: {
  cashInHand?: number | string | null;
  cashAdvanceImpact?: number | string | null;
}) {
  return normalizeMoney(
    normalizeMoney(input.cashInHand) + normalizeMoney(input.cashAdvanceImpact),
  );
}

export function calculateLotteryExpectedCashInHandFromReconciliation(input: {
  openingCashFloat?: number | string | null;
  totalExpectedCash?: number | string | null;
}) {
  return normalizeMoney(
    Math.max(
      normalizeMoney(input.totalExpectedCash) -
        normalizeMoney(input.openingCashFloat),
      0,
    ),
  );
}
