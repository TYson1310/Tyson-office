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

export function isLotteryCashMovementAuditType(
  auditType: string | null | undefined,
) {
  return (
    auditType === "eod" ||
    auditType === "shift" ||
    auditType === "bin_load_retirement"
  );
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

export function calculateLotteryCashMovementScratchSales(
  auditRows: LotteryAuditRevenueRow[],
) {
  return normalizeMoney(
    auditRows.reduce(
      (total, audit) =>
        isLotteryCashMovementAuditType(audit.audit_type)
          ? total + normalizeMoney(audit.calculated_revenue)
          : total,
      0,
    ),
  );
}

export function calculateLotteryCashInHandFromReconciliation(input: {
  posRegisterTotal?: number | string | null;
}) {
  return normalizeMoney(input.posRegisterTotal);
}

export function applyLotteryCashAdvanceImpact(input: {
  cashInHand?: number | string | null;
  cashAdvanceImpact?: number | string | null;
}) {
  return normalizeMoney(
    normalizeMoney(input.cashInHand) + normalizeMoney(input.cashAdvanceImpact),
  );
}

export function applyLotteryCashShortOverImpact(input: {
  cashInHand?: number | string | null;
  shortOverAmount?: number | string | null;
}) {
  return normalizeMoney(
    normalizeMoney(input.cashInHand) - normalizeMoney(input.shortOverAmount),
  );
}

export function calculateLotteryExpectedCashInHandFromReconciliation(input: {
  totalExpectedCash?: number | string | null;
}) {
  return normalizeMoney(input.totalExpectedCash);
}

export function calculateLotteryCashStatsMovement(input: {
  cashingBonus?: number | string | null;
  onlineTotalPayout?: number | string | null;
  scratchCardTotalPayout?: number | string | null;
  scratchSalesTotal?: number | string | null;
  terminalSales?: number | string | null;
  ticketCancels?: number | string | null;
}) {
  return normalizeMoney(
    normalizeMoney(input.scratchSalesTotal) +
      normalizeMoney(input.terminalSales) -
      normalizeMoney(input.onlineTotalPayout) -
      normalizeMoney(input.scratchCardTotalPayout) -
      normalizeMoney(input.cashingBonus) -
      normalizeMoney(input.ticketCancels),
  );
}

export function calculateLotteryEodExpectedCash(input: {
  cashingBonus?: number | string | null;
  onlineTotalPayout?: number | string | null;
  openingCashFloat?: number | string | null;
  scratchCardTotalPayout?: number | string | null;
  scratchSalesTotal?: number | string | null;
  terminalSales?: number | string | null;
  ticketCancels?: number | string | null;
}) {
  return normalizeMoney(
    Math.max(
      normalizeMoney(input.openingCashFloat) +
        normalizeMoney(input.scratchSalesTotal) +
        normalizeMoney(input.terminalSales) -
        normalizeMoney(input.ticketCancels) -
        normalizeMoney(input.onlineTotalPayout) -
        normalizeMoney(input.scratchCardTotalPayout) -
        normalizeMoney(input.cashingBonus),
      0,
    ),
  );
}
