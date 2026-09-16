export function buildLotteryEodReconciliationUpsertPayload(input: {
  closingCashFloat: number;
  createdBy: string;
  discrepancyStatus: "balanced" | "over" | "short";
  managerNotes: string | null;
  openingCashFloat: number;
  reportDate: string;
  shortOverAmount: number;
  storeKey: string;
  tillCash: number;
  totalExpectedCash: number;
}) {
  return {
    closing_cash_float: roundMoney(input.closingCashFloat),
    created_by: input.createdBy,
    discrepancy_status: input.discrepancyStatus,
    manager_notes: input.managerNotes,
    opening_cash_float: roundMoney(input.openingCashFloat),
    pos_register_total: roundMoney(input.tillCash),
    report_date: input.reportDate,
    short_over_amount: roundMoney(input.shortOverAmount),
    store_key: input.storeKey,
    total_expected_cash: roundMoney(input.totalExpectedCash),
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
