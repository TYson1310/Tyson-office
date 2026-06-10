import { unstable_noStore as noStore } from "next/cache";
import {
  addDaysToIsoDateKey,
  enumerateIsoDateRange,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";
import {
  calculateLotteryCashMovementScratchSales,
  calculateLotteryCashStatsMovement,
  calculateLotteryCashInHandFromReconciliation,
  calculateLotteryEodExpectedCash,
  calculateLotteryExpectedCashInHandFromReconciliation,
} from "./cash";
import { isMissingLotteryCashAdvanceMigration } from "./cash-advances";
import { calculateLotteryEftFormula } from "./eft-calculation";
import {
  getLatestLotteryEftSweepDate,
  getLotteryEftSweepPeriod,
} from "./eft-periods";
import {
  buildScratchPackSettlementSales,
  sumScratchPackSettlementsByDate,
  type ScratchPackSettlementSale,
  type ScratchSettlementAuditRow,
} from "./scratch-pack-settlements";

type DailyAuditRow = {
  audit_type: string | null;
  audit_date: string;
  calculated_revenue: number | string | null;
};

type TerminalReportRow = {
  report_date: string;
  draw_sales: number | string;
  draw_payouts: number | string;
  lottery_bonding_fee?: number | string | null;
  scratch_payouts: number | string;
  total_cashing_bonus: number | string;
  total_cancels: number | string;
};

type EodReconciliationRow = {
  created_at?: string | null;
  report_date: string;
  pos_register_total: number | string;
  short_over_amount: number | string;
  total_expected_cash: number | string;
  updated_at?: string | null;
};

type LotteryDashboardEftPaymentStatus = "paid" | "unpaid";

type InventoryRow = {
  id: string;
  pack_id: string | null;
  pack_number: string;
  game_id: string;
  status?: "active" | "backstock" | "returned" | "sold_out" | "settled";
  bin_number?: number | null;
  received_ticket_number: string | null;
  pack_control_code: string | null;
  pack_ticket_count: number | null;
  date_received: string | null;
  date_activated?: string | null;
  date_returned?: string | null;
  returned_ticket_count?: number | null;
  returned_value?: number | string | null;
  created_at: string;
  updated_at?: string;
};

type GameCatalogRow = {
  game_id: string;
  game_name: string;
  ticket_price: number | string;
  ticket_count: number | null;
};

type EftWeeklyStatusRow = {
  paid_at: string | null;
  paid_amount?: number | string | null;
  sweep_date: string;
  status: LotteryDashboardEftPaymentStatus;
  week_end_date: string | null;
  week_start_date: string | null;
};

type LotteryCashAdvanceImpactRow = {
  advance_date: string;
  amount: number | string;
};

type LotteryCashAdvancePaymentImpactRow = {
  payment_date: string;
  amount: number | string;
};

type LotteryDepositImpactRow = {
  deposit_date: string;
  amount: number | string;
};

type LotteryCashAdvanceTransactionSourceRow = {
  id: string;
  advance_date: string;
  amount: number | string;
  created_at: string | null;
  person_name: string;
  reason: string;
};

type LotteryCashPaybackTransactionSourceRow = {
  id: string;
  advance_id: string;
  amount: number | string;
  created_at: string | null;
  notes: string | null;
  payment_date: string;
};

type LotteryDepositTransactionSourceRow = {
  id: string;
  amount: number | string;
  created_at: string | null;
  deposit_date: string;
  notes: string | null;
};

export type LotteryCashTransactionType =
  | "EOD Cash Count"
  | "Daily Lottery Cash"
  | "Pending Expected Cash"
  | "Cash Advance"
  | "Cash Payback"
  | "Lottery Deposit"
  | "Paid EFT";

export type LotteryCashTransactionRow = {
  id: string;
  amount: number;
  balanceAfter: number;
  businessDate: string;
  details: string;
  recordedAt: string | null;
  type: LotteryCashTransactionType;
};

export type LotteryDashboardSummary = {
  businessDate: string;
  bondingFee: number;
  cashAfterEft: number;
  cashAvailableBeforeEft: number;
  cashingBonus: number;
  cashingBonusCredit: number;
  cashingBonusRate: number;
  cashCounted: number;
  cashInHandCancels: number;
  cashInHandCashAdvanceImpact: number;
  cashInHandBeforePaidEft: number;
  cashInHandCutoffDate: string;
  cashInHandExpectedByStats: number;
  cashInHandLotteryDepositImpact: number;
  cashInHandNetLotterySales: number;
  cashInHandOnlineSales: number;
  cashInHandPayouts: number;
  cashInHandRecordedDays: number;
  cashInHandScratchSales: number;
  countedDays: number;
  currentWeekEftDue: number;
  currentWeekEndDate: string;
  currentWeekStartDate: string;
  drawPayouts: number;
  drawSales: number;
  eftPaidAt: string | null;
  eftPaymentStatus: LotteryDashboardEftPaymentStatus;
  expectedCash: number;
  grossSales: number;
  hasReconciliation: boolean;
  netSales: number;
  netEftDue: number;
  netTicketSales: number;
  payouts: number;
  paidEftTotal: number;
  paidEftWeeks: number;
  pendingDays: number;
  retailerCommissionCredit: number;
  retailerCommissionRate: number;
  revenue: number;
  scratchPayouts: number;
  scratchSales: number;
  settledPackSales: number;
  shortOver: number;
  status: "balanced" | "over" | "pending" | "short";
  sweepDate: string;
  totalCommissions: number;
  totalCredits: number;
  totalPayouts: number;
  ticketCancels: number;
  weekEndDate: string;
  weekStartDate: string;
  windowDays: number;
};

export type LotteryScratchLedgerItem = {
  id: string;
  packId: string;
  packNumber: string;
  gameId: string;
  gameName: string;
  ticketPrice: number;
  status: "active" | "backstock" | "returned" | "sold_out" | "settled";
  binNumber: number | null;
  receivedTicketNumber: string | null;
  packControlCode: string | null;
  packTicketCount: number | null;
  gameTicketCount: number | null;
  dateReceived: string | null;
  dateActivated: string | null;
  dateReturned: string | null;
  returnedTicketCount: number | null;
  returnedValue: number;
};

export type LotteryInventorySummary = {
  activePacks: number;
  activeValue: number;
  backstockPacks: number;
  backstockValue: number;
  returnedPacks: number;
  returnedValue: number;
  soldOutPacks: number;
  soldOutValue: number;
  settledPacks: number;
  settledValue: number;
  totalPacks: number;
  totalValue: number;
};

export type LotteryDashboardData = {
  source: "database" | "unconfigured" | "error";
  storeKey: string;
  timeZone: string;
  cashTransactions: LotteryCashTransactionRow[];
  inventorySummary: LotteryInventorySummary;
  summary: LotteryDashboardSummary;
  scratchLedger: LotteryScratchLedgerItem[];
  errorMessage?: string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const PAGE_SIZE = 1000;
const MIN_REPORT_DATE = "0000-01-01";

function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function formatMoneyForDetails(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function normalizePercent(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }

  return Math.min(normalized, 100);
}

function getSummaryStatus(shortOver: number, countedDays: number) {
  if (countedDays === 0) {
    return "pending" as const;
  }

  if (shortOver > 0) {
    return "short" as const;
  }

  if (shortOver < 0) {
    return "over" as const;
  }

  return "balanced" as const;
}

function groupAuditRowsByDate(auditRows: DailyAuditRow[]) {
  const auditsByDate = new Map<string, DailyAuditRow[]>();

  auditRows.forEach((row) => {
    auditsByDate.set(row.audit_date, [
      ...(auditsByDate.get(row.audit_date) ?? []),
      row,
    ]);
  });

  return auditsByDate;
}

function mapTerminalRowsByDate(terminalRows: TerminalReportRow[]) {
  return new Map(terminalRows.map((row) => [row.report_date, row]));
}

function mapReconciliationRowsByDate(
  reconciliationRows: EodReconciliationRow[],
) {
  return new Map(reconciliationRows.map((row) => [row.report_date, row]));
}

function buildEmptyInventorySummary(): LotteryInventorySummary {
  return {
    activePacks: 0,
    activeValue: 0,
    backstockPacks: 0,
    backstockValue: 0,
    returnedPacks: 0,
    returnedValue: 0,
    soldOutPacks: 0,
    soldOutValue: 0,
    settledPacks: 0,
    settledValue: 0,
    totalPacks: 0,
    totalValue: 0,
  };
}

function buildEmptySummary({
  businessDate,
  cashInHandCutoffDate,
  currentWeekEndDate,
  currentWeekStartDate,
  sweepDate,
  weekEndDate,
  weekStartDate,
}: {
  businessDate: string;
  cashInHandCutoffDate: string;
  currentWeekEndDate: string;
  currentWeekStartDate: string;
  sweepDate: string;
  weekEndDate: string;
  weekStartDate: string;
}): LotteryDashboardSummary {
  return {
    businessDate,
    bondingFee: 0,
    cashAfterEft: 0,
    cashAvailableBeforeEft: 0,
    cashingBonus: 0,
    cashingBonusCredit: 0,
    cashingBonusRate: 0,
    cashCounted: 0,
    cashInHandCancels: 0,
    cashInHandCashAdvanceImpact: 0,
    cashInHandBeforePaidEft: 0,
    cashInHandCutoffDate,
    cashInHandExpectedByStats: 0,
    cashInHandLotteryDepositImpact: 0,
    cashInHandNetLotterySales: 0,
    cashInHandOnlineSales: 0,
    cashInHandPayouts: 0,
    cashInHandRecordedDays: 0,
    cashInHandScratchSales: 0,
    countedDays: 0,
    currentWeekEftDue: 0,
    currentWeekEndDate,
    currentWeekStartDate,
    drawPayouts: 0,
    drawSales: 0,
    eftPaidAt: null,
    eftPaymentStatus: "unpaid",
    expectedCash: 0,
    grossSales: 0,
    hasReconciliation: false,
    netSales: 0,
    netEftDue: 0,
    netTicketSales: 0,
    payouts: 0,
    paidEftTotal: 0,
    paidEftWeeks: 0,
    pendingDays: 0,
    retailerCommissionCredit: 0,
    retailerCommissionRate: 0,
    revenue: 0,
    scratchPayouts: 0,
    scratchSales: 0,
    settledPackSales: 0,
    shortOver: 0,
    status: "pending",
    sweepDate,
    totalCommissions: 0,
    totalCredits: 0,
    totalPayouts: 0,
    ticketCancels: 0,
    weekEndDate,
    weekStartDate,
    windowDays: 0,
  };
}

function buildEmptyCashInHandSummary() {
  return {
    cashAfterEft: 0,
    cashAvailableBeforePaidEft: 0,
    cashInHandCancels: 0,
    cashInHandCashAdvanceImpact: 0,
    cashInHandExpectedByStats: 0,
    cashInHandLotteryDepositImpact: 0,
    cashInHandNetLotterySales: 0,
    cashInHandOnlineSales: 0,
    cashInHandPayouts: 0,
    cashInHandScratchSales: 0,
    paidEftTotal: 0,
    paidEftWeeks: 0,
    recordedDays: 0,
  };
}

async function loadPagedRows<Row>(
  loadPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: Row[] | null;
    error: { code?: string | null; message?: string | null } | null;
  }>,
) {
  const rows: Row[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1);

    if (error) {
      return {
        data: rows,
        error,
      };
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < PAGE_SIZE) {
      return {
        data: rows,
        error: null,
      };
    }
  }
}

function isInDateRange(dateKey: string, startDate: string, endDate: string) {
  return dateKey >= startDate && dateKey <= endDate;
}

function filterTerminalRowsByDateRange(
  rows: TerminalReportRow[],
  startDate: string,
  endDate: string,
) {
  return rows.filter((row) =>
    isInDateRange(row.report_date, startDate, endDate),
  );
}

async function loadAuditRowsThroughDate(
  supabase: SupabaseServerClient,
  storeKey: string,
  endDate: string,
) {
  return loadPagedRows<DailyAuditRow>((from, to) =>
    supabase
      .from("daily_audits")
      .select("audit_date,audit_type,calculated_revenue")
      .eq("store_key", storeKey)
      .in("audit_type", ["eod", "shift", "bin_load_retirement"])
      .lte("audit_date", endDate)
      .order("audit_date", { ascending: true })
      .range(from, to)
      .returns<DailyAuditRow[]>(),
  );
}

async function loadAuditRowsForDateRange(
  supabase: SupabaseServerClient,
  storeKey: string,
  startDate: string,
  endDate: string,
) {
  return loadPagedRows<DailyAuditRow>((from, to) =>
    supabase
      .from("daily_audits")
      .select("audit_date,audit_type,calculated_revenue")
      .eq("store_key", storeKey)
      .in("audit_type", ["eod", "shift", "bin_load_retirement"])
      .gte("audit_date", startDate)
      .lte("audit_date", endDate)
      .order("audit_date", { ascending: true })
      .range(from, to)
      .returns<DailyAuditRow[]>(),
  );
}

async function loadTerminalRowsThroughDate(
  supabase: SupabaseServerClient,
  storeKey: string,
  endDate: string,
) {
  return loadPagedRows<TerminalReportRow>((from, to) =>
    supabase
      .from("terminal_reports")
      .select(
        "report_date,draw_sales,draw_payouts,scratch_payouts,total_cashing_bonus,total_cancels,lottery_bonding_fee",
      )
      .eq("store_key", storeKey)
      .lte("report_date", endDate)
      .order("report_date", { ascending: true })
      .range(from, to)
      .returns<TerminalReportRow[]>(),
  );
}

async function loadTerminalRowsForDateRange(
  supabase: SupabaseServerClient,
  storeKey: string,
  startDate: string,
  endDate: string,
) {
  return loadPagedRows<TerminalReportRow>((from, to) =>
    supabase
      .from("terminal_reports")
      .select(
        "report_date,draw_sales,draw_payouts,scratch_payouts,total_cashing_bonus,total_cancels,lottery_bonding_fee",
      )
      .eq("store_key", storeKey)
      .gte("report_date", startDate)
      .lte("report_date", endDate)
      .order("report_date", { ascending: true })
      .range(from, to)
      .returns<TerminalReportRow[]>(),
  );
}

async function loadEodReconciliationRowsThroughDate(
  supabase: SupabaseServerClient,
  storeKey: string,
  endDate: string,
) {
  return loadPagedRows<EodReconciliationRow>((from, to) =>
    supabase
      .from("eod_reconciliation")
      .select(
        "report_date,total_expected_cash,pos_register_total,short_over_amount,created_at,updated_at",
      )
      .eq("store_key", storeKey)
      .lte("report_date", endDate)
      .order("report_date", { ascending: true })
      .range(from, to)
      .returns<EodReconciliationRow[]>(),
  );
}

async function loadEodReconciliationRowsForDateRange(
  supabase: SupabaseServerClient,
  storeKey: string,
  startDate: string,
  endDate: string,
) {
  return loadPagedRows<EodReconciliationRow>((from, to) =>
    supabase
      .from("eod_reconciliation")
      .select(
        "report_date,total_expected_cash,pos_register_total,short_over_amount,created_at,updated_at",
      )
      .eq("store_key", storeKey)
      .gte("report_date", startDate)
      .lte("report_date", endDate)
      .order("report_date", { ascending: true })
      .range(from, to)
      .returns<EodReconciliationRow[]>(),
  );
}

async function loadLotteryCashAdvanceImpactByDate(
  supabase: SupabaseServerClient,
  storeKey: string,
  endDate: string,
) {
  const [advanceResult, paymentResult] = await Promise.all([
    supabase
      .from("lottery_cash_advances")
      .select("advance_date,amount")
      .eq("store_key", storeKey)
      .eq("status", "posted")
      .lte("advance_date", endDate)
      .returns<LotteryCashAdvanceImpactRow[]>(),
    supabase
      .from("lottery_cash_advance_payments")
      .select("payment_date,amount")
      .eq("store_key", storeKey)
      .eq("status", "posted")
      .lte("payment_date", endDate)
      .returns<LotteryCashAdvancePaymentImpactRow[]>(),
  ]);

  if (
    isMissingLotteryCashAdvanceMigration(advanceResult.error) ||
    isMissingLotteryCashAdvanceMigration(paymentResult.error)
  ) {
    return {
      data: new Map<string, number>(),
      error: null,
    };
  }

  const error = advanceResult.error ?? paymentResult.error;

  if (error) {
    return {
      data: new Map<string, number>(),
      error,
    };
  }

  const impactByDate = new Map<string, number>();

  for (const advance of advanceResult.data ?? []) {
    impactByDate.set(
      advance.advance_date,
      normalizeMoney(
        (impactByDate.get(advance.advance_date) ?? 0) -
          normalizeMoney(advance.amount),
      ),
    );
  }

  for (const payment of paymentResult.data ?? []) {
    impactByDate.set(
      payment.payment_date,
      normalizeMoney(
        (impactByDate.get(payment.payment_date) ?? 0) +
          normalizeMoney(payment.amount),
      ),
    );
  }

  for (const [dateKey, impact] of impactByDate) {
    if (impact === 0) {
      impactByDate.delete(dateKey);
    }
  }

  return {
    data: impactByDate,
    error: null,
  };
}

async function loadLotteryDepositImpactByDate(
  supabase: SupabaseServerClient,
  storeKey: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("bank_deposits")
    .select("deposit_date,amount")
    .eq("store_key", storeKey)
    .eq("status", "posted")
    .eq("cash_source", "lottery_till")
    .lte("deposit_date", endDate)
    .returns<LotteryDepositImpactRow[]>();

  if (error) {
    return {
      data: new Map<string, number>(),
      error,
    };
  }

  const impactByDate = new Map<string, number>();

  for (const deposit of data ?? []) {
    impactByDate.set(
      deposit.deposit_date,
      normalizeMoney(
        (impactByDate.get(deposit.deposit_date) ?? 0) -
          normalizeMoney(deposit.amount),
      ),
    );
  }

  for (const [dateKey, impact] of impactByDate) {
    if (impact === 0) {
      impactByDate.delete(dateKey);
    }
  }

  return {
    data: impactByDate,
    error: null,
  };
}

async function loadLotteryCashTransactionSources(
  supabase: SupabaseServerClient,
  storeKey: string,
  endDate: string,
) {
  const [advanceResult, paybackResult, depositResult, eftStatusResult] =
    await Promise.all([
      supabase
        .from("lottery_cash_advances")
        .select("id,advance_date,amount,person_name,reason,created_at")
        .eq("store_key", storeKey)
        .eq("status", "posted")
        .lte("advance_date", endDate)
        .returns<LotteryCashAdvanceTransactionSourceRow[]>(),
      supabase
        .from("lottery_cash_advance_payments")
        .select("id,advance_id,payment_date,amount,notes,created_at")
        .eq("store_key", storeKey)
        .eq("status", "posted")
        .lte("payment_date", endDate)
        .returns<LotteryCashPaybackTransactionSourceRow[]>(),
      supabase
        .from("bank_deposits")
        .select("id,deposit_date,amount,notes,created_at")
        .eq("store_key", storeKey)
        .eq("status", "posted")
        .eq("cash_source", "lottery_till")
        .lte("deposit_date", endDate)
        .returns<LotteryDepositTransactionSourceRow[]>(),
      loadEftWeeklyStatusRowsThroughSweepDate(supabase, storeKey, endDate),
    ]);

  const cashAdvanceError =
    isMissingLotteryCashAdvanceMigration(advanceResult.error) ||
    isMissingLotteryCashAdvanceMigration(paybackResult.error)
      ? null
      : (advanceResult.error ?? paybackResult.error);
  const error =
    cashAdvanceError ?? depositResult.error ?? eftStatusResult.error;

  if (error) {
    return {
      data: null,
      error,
    };
  }

  return {
    data: {
      advances:
        isMissingLotteryCashAdvanceMigration(advanceResult.error) ||
        isMissingLotteryCashAdvanceMigration(paybackResult.error)
          ? []
          : (advanceResult.data ?? []),
      deposits: depositResult.data ?? [],
      eftStatuses: eftStatusResult.data ?? [],
      paybacks:
        isMissingLotteryCashAdvanceMigration(advanceResult.error) ||
        isMissingLotteryCashAdvanceMigration(paybackResult.error)
          ? []
          : (paybackResult.data ?? []),
    },
    error: null,
  };
}

function isMissingEftWeeklyStatusTableError(error: {
  code?: string | null;
  message?: string | null;
}) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "42P01" ||
    (message.includes("lottery_eft_weekly_status") &&
      (message.includes("does not exist") || message.includes("relation")))
  );
}

function isMissingEftPaidAmountColumnError(error: {
  code?: string | null;
  message?: string | null;
}) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    message.includes("paid_amount") &&
    (error.code === "42703" ||
      error.code === "PGRST204" ||
      message.includes("schema cache"))
  );
}

async function loadEftWeeklyStatusRowsThroughSweepDate(
  supabase: SupabaseServerClient,
  storeKey: string,
  latestSweepDate: string,
) {
  const result = await loadPagedRows<EftWeeklyStatusRow>((from, to) =>
    supabase
      .from("lottery_eft_weekly_status")
      .select(
        "week_start_date,week_end_date,sweep_date,status,paid_at,paid_amount",
      )
      .eq("store_key", storeKey)
      .lte("sweep_date", latestSweepDate)
      .order("sweep_date", { ascending: true })
      .range(from, to)
      .returns<EftWeeklyStatusRow[]>(),
  );

  if (result.error) {
    if (isMissingEftWeeklyStatusTableError(result.error)) {
      return {
        data: [] as EftWeeklyStatusRow[],
        error: null,
      };
    }

    if (isMissingEftPaidAmountColumnError(result.error)) {
      const legacyResult = await loadPagedRows<
        Omit<EftWeeklyStatusRow, "paid_amount">
      >((from, to) =>
        supabase
          .from("lottery_eft_weekly_status")
          .select("week_start_date,week_end_date,sweep_date,status,paid_at")
          .eq("store_key", storeKey)
          .lte("sweep_date", latestSweepDate)
          .order("sweep_date", { ascending: true })
          .range(from, to)
          .returns<Omit<EftWeeklyStatusRow, "paid_amount">[]>(),
      );

      return {
        data:
          legacyResult.data?.map((row) => ({
            ...row,
            paid_amount: null,
          })) ?? [],
        error: legacyResult.error,
      };
    }

    return result;
  }

  return result;
}

async function loadCashInHandSummary({
  cashAdvanceImpactByDate,
  cutoffDate,
  cashingBonusRate,
  retailerCommissionRate,
  settlementRows,
  storeKey,
  supabase,
  sweepDate,
}: {
  cashAdvanceImpactByDate: Map<string, number>;
  cutoffDate: string;
  cashingBonusRate: number;
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  storeKey: string;
  supabase: SupabaseServerClient;
  sweepDate: string;
}) {
  const lotteryDepositImpactResult = await loadLotteryDepositImpactByDate(
    supabase,
    storeKey,
    cutoffDate,
  );

  if (lotteryDepositImpactResult.error) {
    return {
      data: null,
      error: lotteryDepositImpactResult.error,
    };
  }

  const [
    auditRowsResult,
    terminalRowsResult,
    reconciliationRowsResult,
    eftStatusRowsResult,
  ] = await Promise.all([
    loadAuditRowsThroughDate(supabase, storeKey, cutoffDate),
    loadTerminalRowsThroughDate(supabase, storeKey, cutoffDate),
    loadEodReconciliationRowsThroughDate(supabase, storeKey, cutoffDate),
    loadEftWeeklyStatusRowsThroughSweepDate(supabase, storeKey, sweepDate),
  ]);
  const fallbackError =
    auditRowsResult.error ??
    terminalRowsResult.error ??
    reconciliationRowsResult.error ??
    eftStatusRowsResult.error;

  if (fallbackError) {
    return {
      data: null,
      error: fallbackError,
    };
  }

  return {
    data: buildCashInHandSummary({
      auditRows: auditRowsResult.data ?? [],
      cashAdvanceImpactByDate,
      cashingBonusRate,
      eftStatusRows: eftStatusRowsResult.data ?? [],
      lotteryDepositImpactByDate: lotteryDepositImpactResult.data,
      reconciliationRows: reconciliationRowsResult.data ?? [],
      retailerCommissionRate,
      settlementRows,
      terminalRows: terminalRowsResult.data ?? [],
    }),
    error: null,
  };
}

function getPackTicketCountFromCatalog(game: GameCatalogRow | undefined) {
  const ticketCount =
    typeof game?.ticket_count === "number"
      ? game.ticket_count
      : Number(game?.ticket_count);

  return Number.isFinite(ticketCount) && ticketCount > 0 ? ticketCount : null;
}

function getCatalogPackValue(game: GameCatalogRow | undefined) {
  const ticketCount = getPackTicketCountFromCatalog(game);

  if (!ticketCount) {
    return 0;
  }

  return normalizeMoney(ticketCount * normalizeMoney(game?.ticket_price));
}

function getInventoryValue(
  row: InventoryRow,
  game: GameCatalogRow | undefined,
) {
  if ((row.status ?? "backstock") === "returned") {
    const returnedValue = normalizeMoney(row.returned_value);

    if (returnedValue > 0) {
      return returnedValue;
    }

    const returnedTicketCount =
      typeof row.returned_ticket_count === "number"
        ? row.returned_ticket_count
        : Number(row.returned_ticket_count);

    if (Number.isFinite(returnedTicketCount) && returnedTicketCount > 0) {
      return normalizeMoney(
        returnedTicketCount * normalizeMoney(game?.ticket_price),
      );
    }

    return 0;
  }

  return getCatalogPackValue(game);
}

function buildInventorySummary({
  gameById,
  inventoryRows,
}: {
  gameById: Map<string, GameCatalogRow>;
  inventoryRows: InventoryRow[];
}): LotteryInventorySummary {
  return inventoryRows.reduce<LotteryInventorySummary>((summary, row) => {
    const game = gameById.get(row.game_id);
    const status = row.status ?? "backstock";
    const value = getInventoryValue(row, game);

    summary.totalPacks += 1;
    summary.totalValue = normalizeMoney(summary.totalValue + value);

    if (status === "active") {
      summary.activePacks += 1;
      summary.activeValue = normalizeMoney(summary.activeValue + value);
    } else if (status === "backstock") {
      summary.backstockPacks += 1;
      summary.backstockValue = normalizeMoney(summary.backstockValue + value);
    } else if (status === "returned") {
      summary.returnedPacks += 1;
      summary.returnedValue = normalizeMoney(summary.returnedValue + value);
    } else if (status === "sold_out") {
      summary.soldOutPacks += 1;
      summary.soldOutValue = normalizeMoney(summary.soldOutValue + value);
    } else {
      summary.settledPacks += 1;
      summary.settledValue = normalizeMoney(summary.settledValue + value);
    }

    return summary;
  }, buildEmptyInventorySummary());
}

function mapScratchLedgerItems({
  gameById,
  inventoryRows,
}: {
  gameById: Map<string, GameCatalogRow>;
  inventoryRows: InventoryRow[];
}): LotteryScratchLedgerItem[] {
  return inventoryRows.map((row) => {
    const game = gameById.get(row.game_id);

    return {
      id: row.id,
      binNumber: row.bin_number ?? null,
      dateActivated: row.date_activated ?? null,
      dateReceived: row.date_received ?? row.created_at,
      dateReturned: row.date_returned ?? null,
      gameId: row.game_id,
      gameName: game?.game_name ?? "Unknown game",
      gameTicketCount: game?.ticket_count ?? null,
      packControlCode: row.pack_control_code,
      packId: row.pack_id ?? `${row.game_id}-${row.pack_number}`,
      packNumber: row.pack_number,
      packTicketCount: row.pack_ticket_count,
      receivedTicketNumber: row.received_ticket_number,
      returnedTicketCount: row.returned_ticket_count ?? null,
      returnedValue: normalizeMoney(row.returned_value),
      status: row.status ?? "backstock",
      ticketPrice: normalizeMoney(game?.ticket_price),
    };
  });
}

function buildEftWindowSummary({
  auditRows,
  businessDate,
  cashingBonusRate,
  dateKeys,
  eftStatus,
  retailerCommissionRate,
  settlementRows,
  terminalRows,
  reconciliationRows,
  sweepDate,
  weekEndDate,
  weekStartDate,
}: {
  auditRows: DailyAuditRow[];
  businessDate: string;
  cashingBonusRate: number;
  dateKeys: string[];
  eftStatus: EftWeeklyStatusRow | null;
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  terminalRows: TerminalReportRow[];
  reconciliationRows: EodReconciliationRow[];
  sweepDate: string;
  weekEndDate: string;
  weekStartDate: string;
}): LotteryDashboardSummary {
  const auditsByDate = groupAuditRowsByDate(auditRows);
  const settlementsByDate = sumScratchPackSettlementsByDate(settlementRows);
  const terminalsByDate = mapTerminalRowsByDate(terminalRows);
  const reconciliationsByDate = mapReconciliationRowsByDate(reconciliationRows);

  return dateKeys.reduce<LotteryDashboardSummary>(
    (summary, reportDate) => {
      const terminal = terminalsByDate.get(reportDate);
      const reconciliation = reconciliationsByDate.get(reportDate);
      const scratchSales = calculateLotteryCashMovementScratchSales(
        auditsByDate.get(reportDate) ?? [],
      );
      const drawSales = normalizeMoney(terminal?.draw_sales);
      const drawPayouts = normalizeMoney(terminal?.draw_payouts);
      const bondingFee = normalizeMoney(terminal?.lottery_bonding_fee);
      const scratchPayouts = normalizeMoney(terminal?.scratch_payouts);
      const cashingBonus = normalizeMoney(terminal?.total_cashing_bonus);
      const ticketCancels = normalizeMoney(terminal?.total_cancels);
      const settledPackSales = normalizeMoney(
        settlementsByDate.get(reportDate),
      );
      const eftGrossSales = normalizeMoney(drawSales + settledPackSales);
      const grossSales = normalizeMoney(scratchSales + drawSales);
      const netSales = normalizeMoney(Math.max(grossSales - ticketCancels, 0));
      const payouts = normalizeMoney(
        drawPayouts + scratchPayouts + cashingBonus,
      );
      const calculatedExpectedCash = calculateLotteryEodExpectedCash({
        cashingBonus,
        onlineTotalPayout: drawPayouts,
        scratchCardTotalPayout: scratchPayouts,
        scratchSalesTotal: scratchSales,
        terminalSales: drawSales,
        ticketCancels,
      });
      const expectedCash = reconciliation
        ? calculateLotteryExpectedCashInHandFromReconciliation({
            totalExpectedCash: reconciliation.total_expected_cash,
          })
        : calculatedExpectedCash;
      const eftFormula = calculateLotteryEftFormula({
        administrativeFees: 0,
        bondingFee,
        grossSales: eftGrossSales,
        payoutCommissionRate: cashingBonusRate,
        promoCredits: cashingBonus,
        prizePayouts: drawPayouts + scratchPayouts,
        retailerCommissionRate,
        ticketCancels,
      });

      summary.cashingBonus = normalizeMoney(
        summary.cashingBonus + cashingBonus,
      );
      summary.cashingBonusCredit = normalizeMoney(
        summary.cashingBonusCredit + eftFormula.payoutCommissionCredit,
      );
      summary.drawPayouts = normalizeMoney(summary.drawPayouts + drawPayouts);
      summary.drawSales = normalizeMoney(summary.drawSales + drawSales);
      summary.bondingFee = normalizeMoney(
        summary.bondingFee + eftFormula.bondingFee,
      );
      summary.expectedCash = normalizeMoney(
        summary.expectedCash + expectedCash,
      );
      summary.grossSales = normalizeMoney(summary.grossSales + grossSales);
      summary.netSales = normalizeMoney(summary.netSales + netSales);
      summary.netEftDue = normalizeMoney(
        summary.netEftDue + eftFormula.netEftDue,
      );
      summary.netTicketSales = normalizeMoney(
        summary.netTicketSales + eftFormula.netTicketSales,
      );
      summary.payouts = normalizeMoney(summary.payouts + payouts);
      summary.retailerCommissionCredit = normalizeMoney(
        summary.retailerCommissionCredit + eftFormula.retailerCommissionCredit,
      );
      summary.revenue = summary.grossSales;
      summary.scratchPayouts = normalizeMoney(
        summary.scratchPayouts + scratchPayouts,
      );
      summary.scratchSales = normalizeMoney(
        summary.scratchSales + scratchSales,
      );
      summary.settledPackSales = normalizeMoney(
        summary.settledPackSales + settledPackSales,
      );
      summary.totalCommissions = normalizeMoney(
        summary.totalCommissions + eftFormula.totalCommissions,
      );
      summary.totalCredits = normalizeMoney(
        summary.totalCredits + eftFormula.totalCredits,
      );
      summary.totalPayouts = normalizeMoney(
        summary.totalPayouts + eftFormula.totalPayouts,
      );
      summary.ticketCancels = normalizeMoney(
        summary.ticketCancels + ticketCancels,
      );

      if (reconciliation) {
        const cashCounted = calculateLotteryCashInHandFromReconciliation({
          posRegisterTotal: reconciliation.pos_register_total,
        });

        summary.cashCounted = normalizeMoney(summary.cashCounted + cashCounted);
        summary.cashAvailableBeforeEft = normalizeMoney(
          summary.cashAvailableBeforeEft + cashCounted,
        );
        summary.countedDays += 1;
        summary.shortOver = normalizeMoney(
          summary.shortOver + expectedCash - cashCounted,
        );
      } else {
        summary.cashAvailableBeforeEft = normalizeMoney(
          summary.cashAvailableBeforeEft + expectedCash,
        );
        summary.pendingDays += 1;
      }

      summary.cashAfterEft = normalizeMoney(
        summary.cashAvailableBeforeEft -
          (summary.eftPaymentStatus === "paid" ? summary.netEftDue : 0),
      );
      summary.hasReconciliation = summary.countedDays > 0;
      summary.status = getSummaryStatus(summary.shortOver, summary.countedDays);

      return summary;
    },
    {
      ...buildEmptySummary({
        businessDate,
        cashInHandCutoffDate: businessDate,
        currentWeekEndDate: businessDate,
        currentWeekStartDate: sweepDate,
        sweepDate,
        weekEndDate,
        weekStartDate,
      }),
      eftPaidAt: eftStatus?.paid_at ?? null,
      eftPaymentStatus: eftStatus?.status ?? "unpaid",
      cashingBonusRate,
      retailerCommissionRate,
      windowDays: dateKeys.length,
    },
  );
}

function calculateDailyExpectedCash({
  auditsByDate,
  reportDate,
  terminal,
}: {
  auditsByDate: Map<string, DailyAuditRow[]>;
  reportDate: string;
  terminal: TerminalReportRow | undefined;
}) {
  const scratchSales = calculateLotteryCashMovementScratchSales(
    auditsByDate.get(reportDate) ?? [],
  );
  const drawSales = normalizeMoney(terminal?.draw_sales);
  const drawPayouts = normalizeMoney(terminal?.draw_payouts);
  const scratchPayouts = normalizeMoney(terminal?.scratch_payouts);
  const cashingBonus = normalizeMoney(terminal?.total_cashing_bonus);
  const ticketCancels = normalizeMoney(terminal?.total_cancels);

  return calculateLotteryCashStatsMovement({
    cashingBonus,
    onlineTotalPayout: drawPayouts,
    scratchCardTotalPayout: scratchPayouts,
    scratchSalesTotal: scratchSales,
    terminalSales: drawSales,
    ticketCancels,
  });
}

function calculateNetEftDueForPeriod({
  cashingBonusRate,
  period,
  retailerCommissionRate,
  settlementRows,
  terminalRows,
}: {
  cashingBonusRate: number;
  period: ReturnType<typeof getLotteryEftSweepPeriod>;
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  terminalRows: TerminalReportRow[];
}) {
  const settlementsByDate = sumScratchPackSettlementsByDate(settlementRows);
  const terminalsByDate = mapTerminalRowsByDate(terminalRows);

  return enumerateIsoDateRange(period.weekStartDate, period.weekEndDate).reduce(
    (total, reportDate) => {
      const terminal = terminalsByDate.get(reportDate);
      const settledPackSales = normalizeMoney(
        settlementsByDate.get(reportDate),
      );
      const eftFormula = calculateLotteryEftFormula({
        administrativeFees: 0,
        bondingFee: normalizeMoney(terminal?.lottery_bonding_fee),
        grossSales: normalizeMoney(
          normalizeMoney(terminal?.draw_sales) + settledPackSales,
        ),
        payoutCommissionRate: cashingBonusRate,
        promoCredits: normalizeMoney(terminal?.total_cashing_bonus),
        prizePayouts:
          normalizeMoney(terminal?.draw_payouts) +
          normalizeMoney(terminal?.scratch_payouts),
        retailerCommissionRate,
        ticketCancels: normalizeMoney(terminal?.total_cancels),
      });

      return normalizeMoney(total + eftFormula.netEftDue);
    },
    0,
  );
}

function buildCashInHandSummary({
  auditRows,
  cashAdvanceImpactByDate,
  cashingBonusRate,
  eftStatusRows,
  lotteryDepositImpactByDate,
  reconciliationRows,
  retailerCommissionRate,
  settlementRows,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  cashAdvanceImpactByDate: Map<string, number>;
  cashingBonusRate: number;
  eftStatusRows: EftWeeklyStatusRow[];
  lotteryDepositImpactByDate: Map<string, number>;
  reconciliationRows: EodReconciliationRow[];
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  terminalRows: TerminalReportRow[];
}) {
  const auditsByDate = groupAuditRowsByDate(auditRows);
  const terminalsByDate = mapTerminalRowsByDate(terminalRows);
  const reportDates = Array.from(
    new Set([
      ...auditRows.map((row) => row.audit_date),
      ...settlementRows.map((row) => row.reportDate),
      ...terminalRows.map((row) => row.report_date),
      ...reconciliationRows.map((row) => row.report_date),
      ...cashAdvanceImpactByDate.keys(),
      ...lotteryDepositImpactByDate.keys(),
    ]),
  ).sort();
  const paidStatusRows = eftStatusRows.filter((row) => row.status === "paid");
  const scratchSalesTotal = calculateLotteryCashMovementScratchSales(auditRows);
  const onlineSalesTotal = normalizeMoney(
    terminalRows.reduce(
      (total, row) => total + normalizeMoney(row.draw_sales),
      0,
    ),
  );
  const payoutsTotal = normalizeMoney(
    terminalRows.reduce(
      (total, row) =>
        total +
        normalizeMoney(row.draw_payouts) +
        normalizeMoney(row.scratch_payouts) +
        normalizeMoney(row.total_cashing_bonus),
      0,
    ),
  );
  const cancelsTotal = normalizeMoney(
    terminalRows.reduce(
      (total, row) => total + normalizeMoney(row.total_cancels),
      0,
    ),
  );
  const netLotterySalesTotal = normalizeMoney(
    scratchSalesTotal + onlineSalesTotal - payoutsTotal - cancelsTotal,
  );
  const cashAdvanceImpactTotal = normalizeMoney(
    Array.from(cashAdvanceImpactByDate.values()).reduce(
      (total, impact) => total + impact,
      0,
    ),
  );
  const lotteryDepositImpactTotal = normalizeMoney(
    Array.from(lotteryDepositImpactByDate.values()).reduce(
      (total, impact) => total + impact,
      0,
    ),
  );
  const cashTimelineEntries: Array<{
    amount: number;
    businessDate: string;
    order: number;
    type: "eft" | "movement";
  }> = [];

  reportDates.forEach((reportDate) => {
    const cashAdvanceImpact = cashAdvanceImpactByDate.get(reportDate) ?? 0;
    const lotteryDepositImpact =
      lotteryDepositImpactByDate.get(reportDate) ?? 0;
    const cashMovementImpact = normalizeMoney(
      cashAdvanceImpact + lotteryDepositImpact,
    );

    const dailyExpectedCash = calculateDailyExpectedCash({
      auditsByDate,
      reportDate,
      terminal: terminalsByDate.get(reportDate),
    });

    if (dailyExpectedCash !== 0) {
      cashTimelineEntries.push({
        amount: dailyExpectedCash,
        businessDate: reportDate,
        order: 20,
        type: "movement",
      });
    }

    if (cashMovementImpact !== 0) {
      cashTimelineEntries.push({
        amount: cashMovementImpact,
        businessDate: reportDate,
        order: 50,
        type: "movement",
      });
    }
  });

  let paidEftTotal = 0;
  let paidEftWeeks = 0;

  paidStatusRows.forEach((statusRow) => {
    const fallbackPeriod = getLotteryEftSweepPeriod(statusRow.sweep_date);
    const period = {
      sweepDate: statusRow.sweep_date,
      weekEndDate: statusRow.week_end_date ?? fallbackPeriod.weekEndDate,
      weekStartDate: statusRow.week_start_date ?? fallbackPeriod.weekStartDate,
    };

    const netEftDue = calculateNetEftDueForPeriod({
      cashingBonusRate,
      period,
      retailerCommissionRate,
      settlementRows,
      terminalRows: filterTerminalRowsByDateRange(
        terminalRows,
        period.weekStartDate,
        period.weekEndDate,
      ),
    });
    const paidEftAmount = normalizeMoney(netEftDue);

    if (paidEftAmount === 0) {
      return;
    }

    paidEftTotal = normalizeMoney(paidEftTotal + paidEftAmount);
    paidEftWeeks += 1;
    cashTimelineEntries.push({
      amount: -paidEftAmount,
      businessDate: statusRow.sweep_date,
      order: 60,
      type: "eft",
    });
  });

  const calculateTimelineBalance = (includePaidEft: boolean) => {
    let balance = 0;

    cashTimelineEntries
      .filter((entry) => includePaidEft || entry.type !== "eft")
      .sort((left, right) => {
        const dateCompare = left.businessDate.localeCompare(right.businessDate);

        if (dateCompare !== 0) {
          return dateCompare;
        }

        return left.order - right.order;
      })
      .forEach((entry) => {
        balance = normalizeMoney(balance + entry.amount);
      });

    return normalizeMoney(balance);
  };
  const cashExpectedByStats = calculateTimelineBalance(true);
  const cashAfterEft = cashExpectedByStats;
  const cashAvailableBeforePaidEft = calculateTimelineBalance(false);

  return {
    cashAfterEft,
    cashAvailableBeforePaidEft,
    cashInHandCancels: cancelsTotal,
    cashInHandCashAdvanceImpact: cashAdvanceImpactTotal,
    cashInHandExpectedByStats: cashExpectedByStats,
    cashInHandLotteryDepositImpact: lotteryDepositImpactTotal,
    cashInHandNetLotterySales: netLotterySalesTotal,
    cashInHandOnlineSales: onlineSalesTotal,
    cashInHandPayouts: payoutsTotal,
    cashInHandScratchSales: scratchSalesTotal,
    paidEftTotal: normalizeMoney(paidEftTotal),
    paidEftWeeks,
    recordedDays: reportDates.length,
  };
}

type LotteryCashTransactionDraft = Omit<
  LotteryCashTransactionRow,
  "balanceAfter"
> & {
  order: number;
};

function getShortOverDetail(shortOver: number) {
  if (shortOver > 0) {
    return `short ${formatMoneyForDetails(shortOver)}`;
  }

  if (shortOver < 0) {
    return `over ${formatMoneyForDetails(Math.abs(shortOver))}`;
  }

  return "balanced";
}

function buildLotteryCashTransactionRows({
  advances,
  auditRows,
  cashingBonusRate,
  deposits,
  eftStatuses,
  reconciliationRows,
  retailerCommissionRate,
  settlementRows,
  terminalRows,
  paybacks,
}: {
  advances: LotteryCashAdvanceTransactionSourceRow[];
  auditRows: DailyAuditRow[];
  cashingBonusRate: number;
  deposits: LotteryDepositTransactionSourceRow[];
  eftStatuses: EftWeeklyStatusRow[];
  reconciliationRows: EodReconciliationRow[];
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  terminalRows: TerminalReportRow[];
  paybacks: LotteryCashPaybackTransactionSourceRow[];
}) {
  const auditsByDate = groupAuditRowsByDate(auditRows);
  const terminalsByDate = mapTerminalRowsByDate(terminalRows);
  const reconciliationsByDate = mapReconciliationRowsByDate(reconciliationRows);
  const reportDates = Array.from(
    new Set([
      ...auditRows.map((row) => row.audit_date),
      ...terminalRows.map((row) => row.report_date),
      ...reconciliationRows.map((row) => row.report_date),
    ]),
  ).sort();
  const rows: LotteryCashTransactionDraft[] = [];

  for (const reportDate of reportDates) {
    const reconciliation = reconciliationsByDate.get(reportDate);
    const dailyExpectedCash = calculateDailyExpectedCash({
      auditsByDate,
      reportDate,
      terminal: terminalsByDate.get(reportDate),
    });

    if (reconciliation) {
      const cashCounted = calculateLotteryCashInHandFromReconciliation({
        posRegisterTotal: reconciliation.pos_register_total,
      });
      const shortOver = normalizeMoney(reconciliation.short_over_amount);

      if (dailyExpectedCash !== 0) {
        rows.push({
          amount: dailyExpectedCash,
          businessDate: reportDate,
          details: `Lottery cash movement from scratch sales, terminal sales, payouts, cancels, and PROMO. EOD counted ${formatMoneyForDetails(
            cashCounted,
          )}; ${getShortOverDetail(shortOver)}.`,
          id: `daily-cash-${reportDate}`,
          order: 20,
          recordedAt:
            reconciliation.updated_at ?? reconciliation.created_at ?? null,
          type: "Daily Lottery Cash",
        });
      }
      continue;
    }

    if (dailyExpectedCash !== 0) {
      rows.push({
        amount: dailyExpectedCash,
        businessDate: reportDate,
        details:
          "Estimated lottery cash from scratch sales, terminal sales, payouts, cancels, and PROMO.",
        id: `pending-cash-${reportDate}`,
        order: 20,
        recordedAt: null,
        type: "Pending Expected Cash",
      });
    }
  }

  advances.forEach((advance) => {
    rows.push({
      amount: -normalizeMoney(advance.amount),
      businessDate: advance.advance_date,
      details: `Advance to ${advance.person_name}: ${advance.reason}`,
      id: `advance-${advance.id}`,
      order: 30,
      recordedAt: advance.created_at,
      type: "Cash Advance",
    });
  });

  paybacks.forEach((payback) => {
    rows.push({
      amount: normalizeMoney(payback.amount),
      businessDate: payback.payment_date,
      details: payback.notes
        ? `Cash advance payback: ${payback.notes}`
        : "Cash advance payback",
      id: `payback-${payback.id}`,
      order: 40,
      recordedAt: payback.created_at,
      type: "Cash Payback",
    });
  });

  deposits.forEach((deposit) => {
    rows.push({
      amount: -normalizeMoney(deposit.amount),
      businessDate: deposit.deposit_date,
      details: deposit.notes
        ? `Lottery till bank deposit: ${deposit.notes}`
        : "Lottery till bank deposit",
      id: `deposit-${deposit.id}`,
      order: 50,
      recordedAt: deposit.created_at,
      type: "Lottery Deposit",
    });
  });

  eftStatuses
    .filter((statusRow) => statusRow.status === "paid")
    .forEach((statusRow) => {
      const fallbackPeriod = getLotteryEftSweepPeriod(statusRow.sweep_date);
      const period = {
        sweepDate: statusRow.sweep_date,
        weekEndDate: statusRow.week_end_date ?? fallbackPeriod.weekEndDate,
        weekStartDate:
          statusRow.week_start_date ?? fallbackPeriod.weekStartDate,
      };
      const netEftDue = calculateNetEftDueForPeriod({
        cashingBonusRate,
        period,
        retailerCommissionRate,
        settlementRows,
        terminalRows: filterTerminalRowsByDateRange(
          terminalRows,
          period.weekStartDate,
          period.weekEndDate,
        ),
      });
      const appliedEftPaid = normalizeMoney(netEftDue);

      if (appliedEftPaid === 0) {
        return;
      }

      rows.push({
        amount: -appliedEftPaid,
        businessDate: statusRow.sweep_date,
        details: `Paid lottery EFT sweep for ${period.weekStartDate} to ${period.weekEndDate}`,
        id: `paid-eft-${statusRow.sweep_date}`,
        order: 60,
        recordedAt: statusRow.paid_at,
        type: "Paid EFT",
      });
    });

  const chronologicalRows = rows.sort((left, right) => {
    const dateCompare = left.businessDate.localeCompare(right.businessDate);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return (left.recordedAt ?? "").localeCompare(right.recordedAt ?? "");
  });
  let balance = 0;

  return chronologicalRows
    .map((row) => {
      balance = normalizeMoney(balance + row.amount);

      return {
        amount: row.amount,
        balanceAfter: balance,
        businessDate: row.businessDate,
        details: row.details,
        id: row.id,
        recordedAt: row.recordedAt,
        type: row.type,
      };
    })
    .reverse();
}

export async function loadLotteryDashboardData(): Promise<LotteryDashboardData> {
  noStore();

  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const businessDate = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const cashInHandCutoffDate = addDaysToIsoDateKey(businessDate, -1);
  const cashInHandSweepDate = getLatestLotteryEftSweepDate(
    cashInHandCutoffDate,
  );
  const sweepDate = getLatestLotteryEftSweepDate(businessDate);
  const { weekEndDate, weekStartDate } = getLotteryEftSweepPeriod(sweepDate);
  const currentWeekStartDate = sweepDate;
  const currentWeekEndDate = businessDate;
  const dateKeys = enumerateIsoDateRange(weekStartDate, weekEndDate);
  const emptySummary = buildEmptySummary({
    businessDate,
    cashInHandCutoffDate,
    currentWeekEndDate,
    currentWeekStartDate,
    sweepDate,
    weekEndDate,
    weekStartDate,
  });
  const emptyInventorySummary = buildEmptyInventorySummary();

  if (!isSupabaseConfigured()) {
    return {
      source: "unconfigured",
      storeKey: activeStoreKey,
      timeZone: activeStore.timeZone,
      cashTransactions: [],
      inventorySummary: emptyInventorySummary,
      summary: emptySummary,
      scratchLedger: [],
    };
  }

  const supabase = await createClient();
  const storeSettings = await loadStoreSettingsForStore(
    supabase,
    activeStoreKey,
  );
  const retailerCommissionRate = normalizePercent(
    storeSettings.lottery.retailerCommissionRate,
  );
  const cashingBonusRate = normalizePercent(
    storeSettings.lottery.cashingBonusRate,
  );
  const [
    auditsResult,
    terminalReportsResult,
    reconciliationResult,
    scratchLedgerResult,
    eftStatusResult,
    currentWeekTerminalReportsResult,
    settlementAuditResult,
    cashAdvanceImpactResult,
    cashAuditRowsResult,
    cashTerminalRowsResult,
    cashReconciliationRowsResult,
    cashTransactionSourcesResult,
  ] = await Promise.all([
    loadAuditRowsForDateRange(
      supabase,
      activeStoreKey,
      weekStartDate,
      weekEndDate,
    ),
    loadTerminalRowsForDateRange(
      supabase,
      activeStoreKey,
      weekStartDate,
      weekEndDate,
    ),
    loadEodReconciliationRowsForDateRange(
      supabase,
      activeStoreKey,
      weekStartDate,
      weekEndDate,
    ),
    supabase
      .from("inventory")
      .select(
        "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,date_returned,returned_ticket_count,returned_value,created_at,updated_at",
      )
      .eq("store_key", activeStoreKey)
      .in("status", ["backstock", "active", "sold_out", "settled", "returned"])
      .order("date_received", { ascending: false })
      .returns<InventoryRow[]>(),
    supabase
      .from("lottery_eft_weekly_status")
      .select("week_start_date,week_end_date,sweep_date,status,paid_at")
      .eq("store_key", activeStoreKey)
      .eq("sweep_date", sweepDate)
      .maybeSingle<EftWeeklyStatusRow>(),
    loadTerminalRowsForDateRange(
      supabase,
      activeStoreKey,
      currentWeekStartDate,
      currentWeekEndDate,
    ),
    supabase
      .from("daily_audits")
      .select("inventory_id,audit_date,audit_type,end_ticket_no,created_at")
      .eq("store_key", activeStoreKey)
      .not("inventory_id", "is", null)
      .not("end_ticket_no", "is", null)
      .lte("audit_date", businessDate)
      .returns<ScratchSettlementAuditRow[]>(),
    loadLotteryCashAdvanceImpactByDate(
      supabase,
      activeStoreKey,
      cashInHandCutoffDate,
    ),
    loadAuditRowsThroughDate(supabase, activeStoreKey, cashInHandCutoffDate),
    loadTerminalRowsThroughDate(supabase, activeStoreKey, cashInHandCutoffDate),
    loadEodReconciliationRowsThroughDate(
      supabase,
      activeStoreKey,
      cashInHandCutoffDate,
    ),
    loadLotteryCashTransactionSources(
      supabase,
      activeStoreKey,
      cashInHandCutoffDate,
    ),
  ]);

  const eftStatusError =
    eftStatusResult.error &&
    !isMissingEftWeeklyStatusTableError(eftStatusResult.error)
      ? eftStatusResult.error
      : null;
  const firstError =
    auditsResult.error ??
    terminalReportsResult.error ??
    reconciliationResult.error ??
    scratchLedgerResult.error ??
    eftStatusError ??
    currentWeekTerminalReportsResult.error ??
    settlementAuditResult.error ??
    cashAdvanceImpactResult.error ??
    cashAuditRowsResult.error ??
    cashTerminalRowsResult.error ??
    cashReconciliationRowsResult.error ??
    cashTransactionSourcesResult.error;

  if (firstError) {
    return {
      source: "error",
      storeKey: activeStoreKey,
      timeZone: activeStore.timeZone,
      cashTransactions: [],
      inventorySummary: emptyInventorySummary,
      summary: emptySummary,
      scratchLedger: [],
      errorMessage:
        firstError.message ?? "Lottery dashboard data could not be loaded.",
    };
  }

  const auditRows = auditsResult.data ?? [];
  const terminalRows = terminalReportsResult.data ?? [];
  const currentWeekTerminalRows = currentWeekTerminalReportsResult.data ?? [];
  const reconciliationRows = reconciliationResult.data ?? [];
  const currentEftStatus =
    eftStatusError || eftStatusResult.error
      ? null
      : (eftStatusResult.data ?? null);
  const scratchLedgerRows = scratchLedgerResult.data ?? [];
  const gameIds = Array.from(
    new Set(scratchLedgerRows.map((row) => row.game_id)),
  );
  let gameRows: GameCatalogRow[] = [];

  if (gameIds.length > 0) {
    const { data } = await supabase
      .from("game_catalog")
      .select("game_id,game_name,ticket_price,ticket_count")
      .in("game_id", gameIds)
      .returns<GameCatalogRow[]>();

    gameRows = data ?? [];
  }

  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const settlementRows = buildScratchPackSettlementSales({
    auditRows: settlementAuditResult.data ?? [],
    endDate: businessDate,
    gameRows,
    inventoryRows: scratchLedgerRows,
    startDate: MIN_REPORT_DATE,
  });
  const cashInHandSummaryResult = await loadCashInHandSummary({
    cashAdvanceImpactByDate: cashAdvanceImpactResult.data,
    cutoffDate: cashInHandCutoffDate,
    cashingBonusRate,
    retailerCommissionRate,
    settlementRows,
    storeKey: activeStoreKey,
    supabase,
    sweepDate: cashInHandSweepDate,
  });

  if (cashInHandSummaryResult.error) {
    return {
      source: "error",
      storeKey: activeStoreKey,
      timeZone: activeStore.timeZone,
      cashTransactions: [],
      inventorySummary: emptyInventorySummary,
      summary: emptySummary,
      scratchLedger: [],
      errorMessage:
        cashInHandSummaryResult.error.message ??
        "Lottery cash-in-hand data could not be loaded.",
    };
  }

  const inventorySummary = buildInventorySummary({
    gameById,
    inventoryRows: scratchLedgerRows,
  });
  const windowSummary = buildEftWindowSummary({
    auditRows,
    businessDate,
    cashingBonusRate,
    dateKeys,
    eftStatus: currentEftStatus,
    reconciliationRows,
    retailerCommissionRate,
    settlementRows,
    sweepDate,
    terminalRows,
    weekEndDate,
    weekStartDate,
  });
  const cashInHandSummary =
    cashInHandSummaryResult.data ?? buildEmptyCashInHandSummary();
  const currentWeekEftDue = calculateNetEftDueForPeriod({
    cashingBonusRate,
    period: {
      sweepDate,
      weekEndDate: currentWeekEndDate,
      weekStartDate: currentWeekStartDate,
    },
    retailerCommissionRate,
    settlementRows,
    terminalRows: currentWeekTerminalRows,
  });
  const summary = {
    ...windowSummary,
    cashAfterEft: cashInHandSummary.cashAfterEft,
    cashInHandCancels: cashInHandSummary.cashInHandCancels,
    cashInHandCashAdvanceImpact:
      cashInHandSummary.cashInHandCashAdvanceImpact,
    cashInHandBeforePaidEft: cashInHandSummary.cashAvailableBeforePaidEft,
    cashInHandCutoffDate,
    cashInHandExpectedByStats: cashInHandSummary.cashInHandExpectedByStats,
    cashInHandLotteryDepositImpact:
      cashInHandSummary.cashInHandLotteryDepositImpact,
    cashInHandNetLotterySales: cashInHandSummary.cashInHandNetLotterySales,
    cashInHandOnlineSales: cashInHandSummary.cashInHandOnlineSales,
    cashInHandPayouts: cashInHandSummary.cashInHandPayouts,
    cashInHandRecordedDays: cashInHandSummary.recordedDays,
    cashInHandScratchSales: cashInHandSummary.cashInHandScratchSales,
    currentWeekEftDue,
    currentWeekEndDate,
    currentWeekStartDate,
    paidEftTotal: cashInHandSummary.paidEftTotal,
    paidEftWeeks: cashInHandSummary.paidEftWeeks,
  };
  const cashTransactionSources = cashTransactionSourcesResult.data ?? {
    advances: [],
    deposits: [],
    eftStatuses: [],
    paybacks: [],
  };
  const cashTransactions = buildLotteryCashTransactionRows({
    advances: cashTransactionSources.advances,
    auditRows: cashAuditRowsResult.data ?? [],
    cashingBonusRate,
    deposits: cashTransactionSources.deposits,
    eftStatuses: cashTransactionSources.eftStatuses,
    paybacks: cashTransactionSources.paybacks,
    reconciliationRows: cashReconciliationRowsResult.data ?? [],
    retailerCommissionRate,
    settlementRows,
    terminalRows: cashTerminalRowsResult.data ?? [],
  });

  return {
    source: "database",
    storeKey: activeStoreKey,
    timeZone: activeStore.timeZone,
    cashTransactions,
    inventorySummary,
    summary,
    scratchLedger: mapScratchLedgerItems({
      gameById,
      inventoryRows: scratchLedgerRows,
    }),
  };
}
