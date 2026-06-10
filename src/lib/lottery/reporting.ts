import { unstable_noStore as noStore } from "next/cache";
import {
  enumerateIsoDateRange,
  getIsoDateRangeEndingTodayInTimeZone,
} from "@/lib/date-time";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { calculateLotteryCashMovementScratchSales } from "./cash";
import {
  buildGameRows,
  SCRATCH_GAME_PERFORMANCE_AUDIT_TYPES,
  type ScratchGamePerformanceRow,
} from "./reporting-game-performance";

type DailyAuditRow = {
  audit_date: string;
  audit_type: string | null;
  bin_number: number;
  calculated_revenue: number | string;
  end_ticket_no: string;
  inventory_id: string | null;
  start_ticket_no: string;
  tickets_sold: number | string;
};

type TerminalReportRow = {
  draw_payouts: number | string;
  draw_sales: number | string;
  report_date: string;
  scratch_payouts: number | string;
  scratch_returns: number | string;
  total_cashing_bonus: number | string;
  total_cancels: number | string;
};

type EodReconciliationRow = {
  manager_notes: string | null;
  pos_register_total: number | string;
  report_date: string;
  total_expected_cash: number | string;
};

type InventoryRow = {
  bin_number: number | null;
  game_id: string;
  id: string;
  pack_id: string | null;
  pack_number: string;
  status: string;
};

type GameCatalogRow = {
  game_id: string;
  game_name: string;
  image_url: string | null;
  ticket_price: number | string;
};

export type LotteryReportDailyRow = {
  cashingBonus: number;
  drawPayouts: number;
  drawSales: number;
  expectedCash: number;
  grossSales: number;
  notes: string;
  payouts: number;
  posRegisterTotal: number;
  reportDate: string;
  scratchPayouts: number;
  scratchReturns: number;
  scratchSales: number;
  shortOver: number;
  status: "balanced" | "over" | "pending" | "short";
  ticketCancels: number;
  ticketsSold: number;
};

export type LotteryReportGameRow = ScratchGamePerformanceRow;

export type LotteryReportSummary = {
  averageDailyGrossSales: number;
  balancedDays: number;
  drawSales: number;
  expectedCash: number;
  grossSales: number;
  overDays: number;
  payouts: number;
  pendingDays: number;
  posRegisterTotal: number;
  scratchReturns: number;
  scratchSales: number;
  shortDays: number;
  shortOver: number;
  ticketCancels: number;
  totalDays: number;
};

export type LotteryReportingData = {
  dailyRows: LotteryReportDailyRow[];
  days: number;
  endDate: string;
  errorMessage?: string;
  gameRows: LotteryReportGameRow[];
  source: "database" | "error" | "unconfigured";
  startDate: string;
  storeKey: string;
  summary: LotteryReportSummary;
};

type LoadLotteryReportingOptions = {
  days?: number;
};

const DEFAULT_REPORT_DAYS = 14;
function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function normalizeInteger(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.max(Math.trunc(normalized), 0) : 0;
}

function normalizeReportDays(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_REPORT_DAYS;
  }

  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_REPORT_DAYS), 1), 90);
}

function buildEmptySummary(totalDays: number): LotteryReportSummary {
  return {
    averageDailyGrossSales: 0,
    balancedDays: 0,
    drawSales: 0,
    expectedCash: 0,
    grossSales: 0,
    overDays: 0,
    payouts: 0,
    pendingDays: totalDays,
    posRegisterTotal: 0,
    scratchReturns: 0,
    scratchSales: 0,
    shortDays: 0,
    shortOver: 0,
    ticketCancels: 0,
    totalDays,
  };
}

function getShortOverStatus(hasReconciliation: boolean, shortOver: number) {
  if (!hasReconciliation) {
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

function buildDailyRows({
  auditRows,
  dateKeys,
  reconciliationRows,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  dateKeys: string[];
  reconciliationRows: EodReconciliationRow[];
  terminalRows: TerminalReportRow[];
}) {
  const auditsByDate = new Map<string, DailyAuditRow[]>();
  const terminalsByDate = new Map<string, TerminalReportRow>();
  const reconciliationsByDate = new Map<string, EodReconciliationRow>();

  auditRows.forEach((row) => {
    const key = row.audit_date;
    auditsByDate.set(key, [...(auditsByDate.get(key) ?? []), row]);
  });

  terminalRows.forEach((row) => terminalsByDate.set(row.report_date, row));
  reconciliationRows.forEach((row) =>
    reconciliationsByDate.set(row.report_date, row),
  );

  return dateKeys
    .map((reportDate) => {
      const dateAudits = auditsByDate.get(reportDate) ?? [];
      const terminal = terminalsByDate.get(reportDate);
      const reconciliation = reconciliationsByDate.get(reportDate);
      const scratchSales = calculateLotteryCashMovementScratchSales(dateAudits);
      const ticketsSold = dateAudits.reduce(
        (total, row) => total + normalizeInteger(row.tickets_sold),
        0,
      );
      const drawSales = normalizeMoney(terminal?.draw_sales);
      const grossSales = normalizeMoney(scratchSales + drawSales);
      const drawPayouts = normalizeMoney(terminal?.draw_payouts);
      const scratchPayouts = normalizeMoney(terminal?.scratch_payouts);
      const scratchReturns = normalizeMoney(terminal?.scratch_returns);
      const cashingBonus = normalizeMoney(terminal?.total_cashing_bonus);
      const ticketCancels = normalizeMoney(terminal?.total_cancels);
      const payouts = normalizeMoney(
        drawPayouts + scratchPayouts + cashingBonus,
      );
      const calculatedExpectedCash = normalizeMoney(
        Math.max(scratchSales + drawSales - payouts - ticketCancels, 0),
      );
      const expectedCash = reconciliation
        ? normalizeMoney(reconciliation.total_expected_cash)
        : calculatedExpectedCash;
      const posRegisterTotal = reconciliation
        ? normalizeMoney(reconciliation.pos_register_total)
        : 0;
      const shortOver = reconciliation
        ? normalizeMoney(expectedCash - posRegisterTotal)
        : 0;

      return {
        cashingBonus,
        drawPayouts,
        drawSales,
        expectedCash,
        grossSales,
        notes: reconciliation?.manager_notes ?? "",
        payouts,
        posRegisterTotal,
        reportDate,
        scratchPayouts,
        scratchReturns,
        scratchSales,
        shortOver,
        status: getShortOverStatus(Boolean(reconciliation), shortOver),
        ticketCancels,
        ticketsSold,
      };
    })
    .reverse();
}

function buildSummary(dailyRows: LotteryReportDailyRow[]) {
  const grossSales = normalizeMoney(
    dailyRows.reduce((total, row) => total + row.grossSales, 0),
  );
  const summary: LotteryReportSummary = {
    averageDailyGrossSales:
      dailyRows.length > 0 ? normalizeMoney(grossSales / dailyRows.length) : 0,
    balancedDays: dailyRows.filter((row) => row.status === "balanced").length,
    drawSales: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.drawSales, 0),
    ),
    expectedCash: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.expectedCash, 0),
    ),
    grossSales,
    overDays: dailyRows.filter((row) => row.status === "over").length,
    payouts: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.payouts, 0),
    ),
    pendingDays: dailyRows.filter((row) => row.status === "pending").length,
    posRegisterTotal: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.posRegisterTotal, 0),
    ),
    scratchSales: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.scratchSales, 0),
    ),
    scratchReturns: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.scratchReturns, 0),
    ),
    shortDays: dailyRows.filter((row) => row.status === "short").length,
    shortOver: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.shortOver, 0),
    ),
    ticketCancels: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.ticketCancels, 0),
    ),
    totalDays: dailyRows.length,
  };

  return summary;
}

export async function loadLotteryReportingData(
  options: LoadLotteryReportingOptions = {},
): Promise<LotteryReportingData> {
  noStore();

  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const days = normalizeReportDays(options.days);
  const { endDate, startDate } = getIsoDateRangeEndingTodayInTimeZone(
    days,
    activeStore.timeZone,
  );
  const dateKeys = enumerateIsoDateRange(startDate, endDate);
  const emptySummary = buildEmptySummary(dateKeys.length);

  if (!isSupabaseConfigured()) {
    return {
      dailyRows: [],
      days,
      endDate,
      gameRows: [],
      source: "unconfigured",
      startDate,
      storeKey: activeStoreKey,
      summary: emptySummary,
    };
  }

  const supabase = await createClient();
  const [auditResult, terminalResult, reconciliationResult] = await Promise.all(
    [
      supabase
        .from("daily_audits")
        .select(
          "audit_date,audit_type,bin_number,calculated_revenue,end_ticket_no,inventory_id,start_ticket_no,tickets_sold",
        )
        .eq("store_key", activeStoreKey)
        .in("audit_type", Array.from(SCRATCH_GAME_PERFORMANCE_AUDIT_TYPES))
        .gte("audit_date", startDate)
        .lte("audit_date", endDate)
        .order("audit_date", { ascending: false })
        .returns<DailyAuditRow[]>(),
      supabase
        .from("terminal_reports")
        .select(
          "report_date,draw_sales,draw_payouts,scratch_payouts,scratch_returns,total_cashing_bonus,total_cancels",
        )
        .eq("store_key", activeStoreKey)
        .gte("report_date", startDate)
        .lte("report_date", endDate)
        .returns<TerminalReportRow[]>(),
      supabase
        .from("eod_reconciliation")
        .select(
          "report_date,total_expected_cash,pos_register_total,manager_notes",
        )
        .eq("store_key", activeStoreKey)
        .gte("report_date", startDate)
        .lte("report_date", endDate)
        .returns<EodReconciliationRow[]>(),
    ],
  );

  const firstError =
    auditResult.error ?? terminalResult.error ?? reconciliationResult.error;

  if (firstError) {
    return {
      dailyRows: [],
      days,
      endDate,
      errorMessage:
        firstError.message ?? "Lottery report data could not be loaded.",
      gameRows: [],
      source: "error",
      startDate,
      storeKey: activeStoreKey,
      summary: emptySummary,
    };
  }

  const auditRows = auditResult.data ?? [];
  const inventoryIds = Array.from(
    new Set(auditRows.map((row) => row.inventory_id).filter(Boolean)),
  ) as string[];
  let inventoryRows: InventoryRow[] = [];

  if (inventoryIds.length > 0) {
    const inventoryResult = await supabase
      .from("inventory")
      .select("id,pack_id,pack_number,game_id,status,bin_number")
      .eq("store_key", activeStoreKey)
      .in("id", inventoryIds)
      .returns<InventoryRow[]>();

    if (inventoryResult.error) {
      return {
        dailyRows: [],
        days,
        endDate,
        errorMessage:
          inventoryResult.error.message ??
          "Lottery inventory report data could not be loaded.",
        gameRows: [],
        source: "error",
        startDate,
        storeKey: activeStoreKey,
        summary: emptySummary,
      };
    }

    inventoryRows = inventoryResult.data ?? [];
  }

  const gameIds = Array.from(new Set(inventoryRows.map((row) => row.game_id)));
  let gameRows: GameCatalogRow[] = [];

  if (gameIds.length > 0) {
    const gameResult = await supabase
      .from("game_catalog")
      .select("game_id,game_name,ticket_price,image_url")
      .in("game_id", gameIds)
      .returns<GameCatalogRow[]>();

    if (gameResult.error) {
      return {
        dailyRows: [],
        days,
        endDate,
        errorMessage:
          gameResult.error.message ??
          "Lottery game report data could not be loaded.",
        gameRows: [],
        source: "error",
        startDate,
        storeKey: activeStoreKey,
        summary: emptySummary,
      };
    }

    gameRows = gameResult.data ?? [];
  }

  const dailyRows = buildDailyRows({
    auditRows,
    dateKeys,
    reconciliationRows: reconciliationResult.data ?? [],
    terminalRows: terminalResult.data ?? [],
  });
  const gameReportRows = buildGameRows({
    auditRows,
    gameById: new Map(gameRows.map((row) => [row.game_id, row])),
    inventoryById: new Map(inventoryRows.map((row) => [row.id, row])),
  });

  return {
    dailyRows,
    days,
    endDate,
    gameRows: gameReportRows,
    source: "database",
    startDate,
    storeKey: activeStoreKey,
    summary: buildSummary(dailyRows),
  };
}

export async function buildLotteryReportExportRows(
  options: LoadLotteryReportingOptions = {},
) {
  const report = await loadLotteryReportingData(options);

  if (report.source !== "database") {
    return [
      {
        section: "status",
        metric: "Source",
        value: report.source,
        message: report.errorMessage ?? "",
      },
    ];
  }

  return [
    {
      section: "summary",
      metric: "Date Range",
      value: `${report.startDate} to ${report.endDate}`,
    },
    {
      section: "summary",
      metric: "Gross Sales",
      value: report.summary.grossSales,
    },
    {
      section: "summary",
      metric: "Scratch Sales",
      value: report.summary.scratchSales,
    },
    {
      section: "summary",
      metric: "Online Sales",
      value: report.summary.drawSales,
    },
    {
      section: "summary",
      metric: "Payouts And PROMO",
      value: report.summary.payouts,
    },
    {
      section: "summary",
      metric: "Ticket Cancels",
      value: report.summary.ticketCancels,
    },
    {
      section: "summary",
      metric: "Scratch Returns",
      value: report.summary.scratchReturns,
    },
    {
      section: "summary",
      metric: "Expected Cash",
      value: report.summary.expectedCash,
    },
    {
      section: "summary",
      metric: "POS Register Total",
      value: report.summary.posRegisterTotal,
    },
    {
      section: "summary",
      metric: "Short Over",
      value: report.summary.shortOver,
    },
    ...report.dailyRows.map((row) => ({
      section: "daily",
      reportDate: row.reportDate,
      status: row.status,
      scratchSales: row.scratchSales,
      drawSales: row.drawSales,
      drawPayouts: row.drawPayouts,
      scratchPayouts: row.scratchPayouts,
      scratchReturns: row.scratchReturns,
      promo: row.cashingBonus,
      ticketCancels: row.ticketCancels,
      onlineAndScratchSales: row.grossSales,
      posRegisterTotal: row.posRegisterTotal,
      shortOver: row.shortOver,
      ticketsSold: row.ticketsSold,
      notes: row.notes,
    })),
    ...report.gameRows.map((row) => ({
      section: "game_performance",
      gameId: row.gameId,
      gameName: row.gameName,
      ticketPrice: row.ticketPrice,
      ticketsSold: row.ticketsSold,
      scratchSales: row.scratchSales,
      packs: row.packCount,
      bins: row.binCount,
      audits: row.auditCount,
    })),
  ];
}
