import { unstable_noStore as noStore } from "next/cache";
import {
  enumerateIsoDateRange,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";
import {
  applyLotteryCashAdvanceImpact,
  calculateLotteryCashInHandFromReconciliation,
  calculateLotteryExpectedCashInHandFromReconciliation,
} from "./cash";
import { isMissingLotteryCashAdvanceMigration } from "./cash-advances";
import { calculateLotteryEftFormula } from "./eft-calculation";
import { calculateAppliedLotteryEftPayment } from "./eft-paid-amount";
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
  audit_date: string;
  calculated_revenue: number | string;
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
  opening_cash_float: number | string | null;
  report_date: string;
  pos_register_total: number | string;
  short_over_amount: number | string;
  total_expected_cash: number | string;
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

type CashInHandSummaryRpcRow = {
  cash_after_eft: number | string | null;
  cash_available_before_paid_eft: number | string | null;
  paid_eft_total: number | string | null;
  paid_eft_weeks: number | null;
  recorded_days: number | null;
};

type LotteryCashAdvanceImpactRow = {
  advance_date: string;
  amount: number | string;
};

type LotteryCashAdvancePaymentImpactRow = {
  payment_date: string;
  amount: number | string;
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
  cashInHandBeforePaidEft: number;
  cashInHandRecordedDays: number;
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

function calculateScratchRevenue(auditRows: DailyAuditRow[]) {
  return normalizeMoney(
    auditRows.reduce(
      (total, audit) => total + normalizeMoney(audit.calculated_revenue),
      0,
    ),
  );
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
  currentWeekEndDate,
  currentWeekStartDate,
  sweepDate,
  weekEndDate,
  weekStartDate,
}: {
  businessDate: string;
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
    cashInHandBeforePaidEft: 0,
    cashInHandRecordedDays: 0,
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
      .select("audit_date,calculated_revenue")
      .eq("store_key", storeKey)
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
      .select("audit_date,calculated_revenue")
      .eq("store_key", storeKey)
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
        "report_date,total_expected_cash,pos_register_total,short_over_amount,opening_cash_float",
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
        "report_date,total_expected_cash,pos_register_total,short_over_amount,opening_cash_float",
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

function isMissingCashInHandSummaryFunction(error: {
  code?: string | null;
  message?: string | null;
}) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    message.includes("get_lottery_cash_in_hand_summary")
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
  businessDate,
  cashingBonusRate,
  retailerCommissionRate,
  settlementRows,
  storeKey,
  supabase,
  sweepDate,
}: {
  cashAdvanceImpactByDate: Map<string, number>;
  businessDate: string;
  cashingBonusRate: number;
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  storeKey: string;
  supabase: SupabaseServerClient;
  sweepDate: string;
}) {
  if (settlementRows.length === 0 && cashAdvanceImpactByDate.size === 0) {
    const rpcResult = await supabase
      .rpc("get_lottery_cash_in_hand_summary", {
        p_end_date: businessDate,
        p_latest_sweep_date: sweepDate,
        p_payout_commission_rate: cashingBonusRate,
        p_retailer_commission_rate: retailerCommissionRate,
        p_store_key: storeKey,
      })
      .maybeSingle<CashInHandSummaryRpcRow>();

    if (!rpcResult.error && rpcResult.data) {
      return {
        data: {
          cashAfterEft: normalizeMoney(rpcResult.data.cash_after_eft),
          cashAvailableBeforePaidEft: normalizeMoney(
            rpcResult.data.cash_available_before_paid_eft,
          ),
          paidEftTotal: normalizeMoney(rpcResult.data.paid_eft_total),
          paidEftWeeks: Number(rpcResult.data.paid_eft_weeks ?? 0),
          recordedDays: Number(rpcResult.data.recorded_days ?? 0),
        },
        error: null,
      };
    }

    if (
      rpcResult.error &&
      !isMissingCashInHandSummaryFunction(rpcResult.error)
    ) {
      return {
        data: null,
        error: rpcResult.error,
      };
    }
  }

  const [
    auditRowsResult,
    terminalRowsResult,
    reconciliationRowsResult,
    eftStatusRowsResult,
  ] = await Promise.all([
    loadAuditRowsThroughDate(supabase, storeKey, businessDate),
    loadTerminalRowsThroughDate(supabase, storeKey, businessDate),
    loadEodReconciliationRowsThroughDate(supabase, storeKey, businessDate),
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
      const scratchSales = calculateScratchRevenue(
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
      const calculatedExpectedCash = normalizeMoney(
        Math.max(netSales - payouts, 0),
      );
      const expectedCash = reconciliation
        ? calculateLotteryExpectedCashInHandFromReconciliation({
            openingCashFloat: reconciliation.opening_cash_float,
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
          openingCashFloat: reconciliation.opening_cash_float,
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
  const scratchSales = calculateScratchRevenue(
    auditsByDate.get(reportDate) ?? [],
  );
  const drawSales = normalizeMoney(terminal?.draw_sales);
  const drawPayouts = normalizeMoney(terminal?.draw_payouts);
  const scratchPayouts = normalizeMoney(terminal?.scratch_payouts);
  const cashingBonus = normalizeMoney(terminal?.total_cashing_bonus);
  const ticketCancels = normalizeMoney(terminal?.total_cancels);
  const grossSales = normalizeMoney(scratchSales + drawSales);
  const netSales = normalizeMoney(Math.max(grossSales - ticketCancels, 0));
  const payouts = normalizeMoney(drawPayouts + scratchPayouts + cashingBonus);

  return normalizeMoney(Math.max(netSales - payouts, 0));
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
  reconciliationRows,
  retailerCommissionRate,
  settlementRows,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  cashAdvanceImpactByDate: Map<string, number>;
  cashingBonusRate: number;
  eftStatusRows: EftWeeklyStatusRow[];
  reconciliationRows: EodReconciliationRow[];
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  terminalRows: TerminalReportRow[];
}) {
  const auditsByDate = groupAuditRowsByDate(auditRows);
  const terminalsByDate = mapTerminalRowsByDate(terminalRows);
  const reconciliationsByDate = mapReconciliationRowsByDate(reconciliationRows);
  const reportDates = Array.from(
    new Set([
      ...auditRows.map((row) => row.audit_date),
      ...settlementRows.map((row) => row.reportDate),
      ...terminalRows.map((row) => row.report_date),
      ...reconciliationRows.map((row) => row.report_date),
      ...cashAdvanceImpactByDate.keys(),
    ]),
  ).sort();
  const cashAvailableBeforePaidEft = normalizeMoney(
    reportDates.reduce((total, reportDate) => {
      const reconciliation = reconciliationsByDate.get(reportDate);
      const cashAdvanceImpact = cashAdvanceImpactByDate.get(reportDate) ?? 0;

      if (reconciliation) {
        return (
          total +
          applyLotteryCashAdvanceImpact({
            cashAdvanceImpact,
            cashInHand: calculateLotteryCashInHandFromReconciliation({
              openingCashFloat: reconciliation.opening_cash_float,
              posRegisterTotal: reconciliation.pos_register_total,
            }),
          })
        );
      }

      return (
        total +
        calculateDailyExpectedCash({
          auditsByDate,
          reportDate,
          terminal: terminalsByDate.get(reportDate),
        }) +
        cashAdvanceImpact
      );
    }, 0),
  );
  const paidStatusRows = eftStatusRows.filter((row) => row.status === "paid");
  const paidEftTotal = normalizeMoney(
    paidStatusRows.reduce((total, statusRow) => {
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

      return (
        total +
        calculateAppliedLotteryEftPayment({
          netEftDue,
          paidAmount: statusRow.paid_amount,
        })
      );
    }, 0),
  );

  return {
    cashAfterEft: normalizeMoney(cashAvailableBeforePaidEft - paidEftTotal),
    cashAvailableBeforePaidEft,
    paidEftTotal,
    paidEftWeeks: paidStatusRows.length,
    recordedDays: reportDates.length,
  };
}

export async function loadLotteryDashboardData(): Promise<LotteryDashboardData> {
  noStore();

  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const businessDate = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const sweepDate = getLatestLotteryEftSweepDate(businessDate);
  const { weekEndDate, weekStartDate } = getLotteryEftSweepPeriod(sweepDate);
  const currentWeekStartDate = sweepDate;
  const currentWeekEndDate = businessDate;
  const dateKeys = enumerateIsoDateRange(weekStartDate, weekEndDate);
  const emptySummary = buildEmptySummary({
    businessDate,
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
    loadLotteryCashAdvanceImpactByDate(supabase, activeStoreKey, businessDate),
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
    cashAdvanceImpactResult.error;

  if (firstError) {
    return {
      source: "error",
      storeKey: activeStoreKey,
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
    businessDate,
    cashAdvanceImpactByDate: cashAdvanceImpactResult.data,
    cashingBonusRate,
    retailerCommissionRate,
    settlementRows,
    storeKey: activeStoreKey,
    supabase,
    sweepDate,
  });

  if (cashInHandSummaryResult.error) {
    return {
      source: "error",
      storeKey: activeStoreKey,
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
    cashInHandBeforePaidEft: cashInHandSummary.cashAvailableBeforePaidEft,
    cashInHandRecordedDays: cashInHandSummary.recordedDays,
    currentWeekEftDue,
    currentWeekEndDate,
    currentWeekStartDate,
    paidEftTotal: cashInHandSummary.paidEftTotal,
    paidEftWeeks: cashInHandSummary.paidEftWeeks,
  };

  return {
    source: "database",
    storeKey: activeStoreKey,
    inventorySummary,
    summary,
    scratchLedger: mapScratchLedgerItems({
      gameById,
      inventoryRows: scratchLedgerRows,
    }),
  };
}
