import type { ScratchCardAccess } from "@/lib/scratch-cards/api";
import {
  getIsoDateKeyInTimeZone,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import {
  loadScratchEodAuditScreenData,
  loadScratchAuditScreenData,
  type ScratchAuditBin,
} from "@/lib/scratch-cards/data";
import {
  loadLotteryCashAdvanceSummary,
  type LotteryCashAdvanceRecord,
} from "@/lib/lottery/cash-advances";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";

type TerminalReportRow = {
  draw_sales: number | string;
  draw_payouts: number | string;
  lottery_bonding_fee?: number | string | null;
  scratch_payouts: number | string;
  total_cashing_bonus: number | string;
  total_cancels: number | string;
};

type EodReconciliationRow = {
  manager_notes: string | null;
  opening_cash_float: number | string;
  pos_register_total: number | string;
};

type LotteryEodSubmissionState = {
  hasExistingReconciliation: boolean;
  hasTerminalReport: boolean;
};

type SaveLotteryEodRow = {
  report_date: string;
  bins_reconciled: number;
  scratch_sales: number | string;
  terminal_sales_total: number | string;
  ticket_cancels_total: number | string;
  online_payout_total: number | string;
  scratch_payout_total: number | string;
  cashing_bonus_total: number | string;
  opening_cash_float?: number | string | null;
  total_expected_cash: number | string;
  till_cash_total: number | string;
  short_over_amount: number | string;
  discrepancy_status: "balanced" | "over" | "short";
};

type NormalizedLotteryBinEntry = {
  bin_number: number;
  end_ticket_number: string;
};

type InventoryPackRow = {
  id: string;
  game_id: string;
  pack_number: string | null;
  date_activated: string | null;
  pack_ticket_count: number | string | null;
};

type ActiveBinRequirementInventoryRow = {
  id: string;
  game_id: string;
  bin_number: number | null;
  pack_ticket_count: number | string | null;
};

type ActiveBinRequirementGameRow = {
  game_id: string;
  ticket_count: number | string | null;
};

type ActiveBinRequirementAuditRow = {
  inventory_id: string | null;
  start_ticket_no: string | null;
  end_ticket_no: string | null;
  tickets_sold: number | string | null;
  audit_date: string;
  created_at: string;
};

type LotteryEodBinAccountability = {
  skippedSoldOutBinNumbers: Set<number>;
};

type GameCatalogRow = {
  game_id: string;
  ticket_count: number | string | null;
  ticket_price: number | string;
};

type DailyAuditLookupRow = {
  audit_id: string;
  inventory_id: string | null;
  bin_number: number | null;
  audit_date: string;
  audit_type: string | null;
  end_ticket_no: string | null;
  tickets_sold: number | string | null;
  calculated_revenue: number | string | null;
  created_at: string;
};

type SupabaseServerClient = ScratchCardAccess["supabase"];

export type LotteryEodReconciliationData = {
  source: "database" | "error" | "unconfigured";
  businessDate: string;
  bins: ScratchAuditBin[];
  isReconciled: boolean;
  terminalSales: number;
  ticketCancels: number;
  cashingBonus: number;
  lotteryBondFee: number;
  lotteryCashAdvanceNetImpact: number;
  lotteryCashAdvancesAvailable: boolean;
  lotteryCashAdvancesWarning?: string;
  lotteryCashAdvancesTaken: number;
  lotteryCashOpenAdvanceBalance: number;
  lotteryCashOpenAdvances: LotteryCashAdvanceRecord[];
  lotteryCashPaybacksReceived: number;
  onlineTotalPayout: number;
  scratchCardTotalPayout: number;
  scratchSalesToDate: number;
  startingFloat: number;
  tillCash: number;
  managerNotes: string;
  errorMessage?: string;
};

export type LotteryEodReconciliationPayload = {
  binEntries?: unknown;
  date?: unknown;
  managerNotes?: unknown;
  cashingBonus?: unknown;
  lotteryBondFee?: unknown;
  onlineTotalPayout?: unknown;
  scratchCardTotalPayout?: unknown;
  startingFloat?: unknown;
  terminalSales?: unknown;
  ticketCancels?: unknown;
  tillCash?: unknown;
};

export class LotteryEodReconciliationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LotteryEodReconciliationError";
    this.status = status;
  }
}

function getTodayIsoDate(timeZone: string) {
  return getTodayIsoDateInTimeZone(timeZone);
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMoney(value: unknown, label: string) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new LotteryEodReconciliationError(
      `${label} must be zero or greater`,
      400,
    );
  }

  return Math.round(normalized * 100) / 100;
}

function normalizeStoredMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function normalizeDate(value: unknown, todayDate: string) {
  if (value === undefined || value === null || value === "") {
    return todayDate;
  }

  const normalized = normalizeString(value);

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(normalized)) {
    throw new LotteryEodReconciliationError("Date must be YYYY-MM-DD", 400);
  }

  if (normalized > todayDate) {
    throw new LotteryEodReconciliationError(
      "Date cannot be in the future",
      400,
    );
  }

  return normalized;
}

function assertAdminBackdateAccess(
  access: ScratchCardAccess,
  businessDate: string,
) {
  if (businessDate === getTodayIsoDate(access.activeStoreTimeZone)) {
    return;
  }

  if (access.currentUserRole !== "admin") {
    throw new LotteryEodReconciliationError(
      "Only admins can use a past lottery EOD date",
      403,
    );
  }
}

function normalizeTicketNumber(value: unknown, label: string) {
  const normalized = normalizeString(value);

  if (!/^[0-9]{1,3}$/.test(normalized)) {
    throw new LotteryEodReconciliationError(
      `${label} must be 1 to 3 digits`,
      400,
    );
  }

  return String(Number(normalized)).padStart(3, "0");
}

function normalizeStoredTicketValue(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!/^[0-9]{1,3}$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function normalizeStoredTicketCount(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);

  if (
    !Number.isInteger(normalized) ||
    normalized <= 0 ||
    normalized > 1000
  ) {
    return null;
  }

  return normalized;
}

function getTicketCountFromCounts(
  packTicketCount: number | string | null | undefined,
  gameTicketCount: number | string | null | undefined,
) {
  return (
    normalizeStoredTicketCount(packTicketCount) ??
    normalizeStoredTicketCount(gameTicketCount)
  );
}

function getFinalTicketValueFromCounts(
  packTicketCount: number | string | null | undefined,
  gameTicketCount: number | string | null | undefined,
) {
  const ticketCount = getTicketCountFromCounts(
    packTicketCount,
    gameTicketCount,
  );

  return ticketCount === null ? null : ticketCount - 1;
}

function isNewerRequirementAudit(
  candidate: ActiveBinRequirementAuditRow,
  current: ActiveBinRequirementAuditRow,
) {
  return (
    candidate.audit_date > current.audit_date ||
    (candidate.audit_date === current.audit_date &&
      candidate.created_at > current.created_at)
  );
}

function isSoldOutRequirementAudit(input: {
  audit: ActiveBinRequirementAuditRow | undefined;
  ticketCount: number | null;
}) {
  const { audit, ticketCount } = input;

  if (!audit || ticketCount === null) {
    return false;
  }

  const endTicketValue = normalizeStoredTicketValue(audit.end_ticket_no);
  const startTicketValue = normalizeStoredTicketValue(audit.start_ticket_no);
  const ticketsSold = normalizeStoredMoney(audit.tickets_sold);

  return (
    endTicketValue !== null &&
    startTicketValue !== null &&
    endTicketValue >= ticketCount - 1 &&
    ticketsSold >= ticketCount - startTicketValue
  );
}

function normalizeBinEntries(value: unknown) {
  if (!Array.isArray(value)) {
    throw new LotteryEodReconciliationError(
      "Bin end ticket entries are required",
      400,
    );
  }

  const seenBinNumbers = new Set<number>();

  return value.map((entry, index) => {
    const record = entry as {
      binNumber?: unknown;
      endTicketNumber?: unknown;
    };
    const binNumber =
      typeof record.binNumber === "number"
        ? record.binNumber
        : typeof record.binNumber === "string"
          ? Number(record.binNumber)
          : Number.NaN;

    if (!Number.isInteger(binNumber) || binNumber <= 0) {
      throw new LotteryEodReconciliationError(
        `Bin entry ${index + 1} needs a valid bin number`,
        400,
      );
    }

    if (seenBinNumbers.has(binNumber)) {
      throw new LotteryEodReconciliationError(
        `Bin ${binNumber} was entered more than once`,
        400,
      );
    }

    seenBinNumbers.add(binNumber);

    return {
      bin_number: binNumber,
      end_ticket_number: normalizeTicketNumber(
        record.endTicketNumber,
        `Bin ${binNumber} ending ticket number`,
      ),
    };
  });
}

function mapRpcError(error: { code?: string; message?: string }) {
  const statusByCode: Record<string, number> = {
    "22023": 400,
    "23505": 409,
    "42501": 403,
    P0002: 404,
  };

  return new LotteryEodReconciliationError(
    error.message ?? "Lottery EOD reconciliation failed",
    error.code ? (statusByCode[error.code] ?? 500) : 500,
  );
}

function getSingleRpcRow<T>(rows: T[] | T | null) {
  const row = Array.isArray(rows) ? rows[0] : rows;

  if (!row) {
    throw new LotteryEodReconciliationError(
      "Lottery EOD reconciliation did not return data",
      500,
    );
  }

  return row;
}

export async function loadLotteryEodReconciliationData(input?: {
  date?: unknown;
}): Promise<LotteryEodReconciliationData> {
  const { activeStore } = await requireActiveStoreContext();
  const todayDate = getTodayIsoDate(activeStore.timeZone);
  const businessDate = normalizeDate(input?.date, todayDate);
  const auditData =
    businessDate === todayDate
      ? await loadScratchAuditScreenData()
      : await loadScratchEodAuditScreenData(businessDate);

  if (auditData.source !== "database" || !isSupabaseConfigured()) {
    return {
      source: auditData.source,
      businessDate,
      bins: auditData.bins,
      errorMessage: auditData.errorMessage,
      isReconciled: false,
      managerNotes: "",
      onlineTotalPayout: 0,
      cashingBonus: 0,
      lotteryBondFee: 0,
      lotteryCashAdvanceNetImpact: 0,
      lotteryCashAdvancesAvailable: false,
      lotteryCashAdvancesTaken: 0,
      lotteryCashOpenAdvanceBalance: 0,
      lotteryCashOpenAdvances: [],
      lotteryCashPaybacksReceived: 0,
      scratchCardTotalPayout: 0,
      scratchSalesToDate: 0,
      startingFloat: 0,
      terminalSales: 0,
      ticketCancels: 0,
      tillCash: 0,
    };
  }

  const supabase = await createClient();
  const [
    terminalReportResult,
    reconciliationResult,
    auditResult,
    cashAdvanceSummary,
  ] = await Promise.all([
    supabase
      .from("terminal_reports")
      .select(
        "draw_sales,draw_payouts,scratch_payouts,total_cashing_bonus,total_cancels,lottery_bonding_fee",
      )
      .eq("store_key", auditData.storeKey)
      .eq("report_date", businessDate)
      .maybeSingle<TerminalReportRow>(),
    loadEodReconciliationRow(supabase, auditData.storeKey, businessDate),
    supabase
      .from("daily_audits")
      .select("calculated_revenue")
      .eq("store_key", auditData.storeKey)
      .eq("audit_date", businessDate)
      .returns<Array<{ calculated_revenue: number | string }>>(),
    loadLotteryCashAdvanceSummary({
      supabase,
      storeKey: auditData.storeKey,
      businessDate,
    }),
  ]);

  const error =
    terminalReportResult.error ??
    reconciliationResult.error ??
    auditResult.error;

  if (error) {
    return {
      source: "error",
      businessDate,
      bins: auditData.bins,
      errorMessage: error.message ?? "Lottery EOD data could not be loaded.",
      isReconciled: false,
      managerNotes: "",
      onlineTotalPayout: 0,
      cashingBonus: 0,
      lotteryBondFee: 0,
      lotteryCashAdvanceNetImpact: 0,
      lotteryCashAdvancesAvailable: false,
      lotteryCashAdvancesTaken: 0,
      lotteryCashAdvancesWarning:
        error.message ?? "Lottery EOD data could not be loaded.",
      lotteryCashOpenAdvanceBalance: 0,
      lotteryCashOpenAdvances: [],
      lotteryCashPaybacksReceived: 0,
      scratchCardTotalPayout: 0,
      scratchSalesToDate: 0,
      startingFloat: 0,
      terminalSales: 0,
      ticketCancels: 0,
      tillCash: 0,
    };
  }

  const existingReconciliation = reconciliationResult.data;

  return {
    source: "database",
    businessDate,
    bins: auditData.bins,
    isReconciled: Boolean(terminalReportResult.data),
    managerNotes: existingReconciliation?.manager_notes ?? "",
    onlineTotalPayout: normalizeStoredMoney(
      terminalReportResult.data?.draw_payouts,
    ),
    cashingBonus: normalizeStoredMoney(
      terminalReportResult.data?.total_cashing_bonus,
    ),
    lotteryBondFee: normalizeStoredMoney(
      terminalReportResult.data?.lottery_bonding_fee,
    ),
    lotteryCashAdvanceNetImpact: cashAdvanceSummary.dailyNetCashImpact,
    lotteryCashAdvancesAvailable: cashAdvanceSummary.available,
    lotteryCashAdvancesTaken: cashAdvanceSummary.dailyAdvanceTotal,
    lotteryCashAdvancesWarning: cashAdvanceSummary.warning,
    lotteryCashOpenAdvanceBalance: cashAdvanceSummary.openBalance,
    lotteryCashOpenAdvances: cashAdvanceSummary.openAdvances,
    lotteryCashPaybacksReceived: cashAdvanceSummary.dailyPaybackTotal,
    scratchCardTotalPayout: normalizeStoredMoney(
      terminalReportResult.data?.scratch_payouts,
    ),
    scratchSalesToDate: normalizeStoredMoney(
      (auditResult.data ?? []).reduce(
        (total, audit) =>
          total + normalizeStoredMoney(audit.calculated_revenue),
        0,
      ),
    ),
    startingFloat: normalizeStoredMoney(
      existingReconciliation?.opening_cash_float,
    ),
    terminalSales: normalizeStoredMoney(terminalReportResult.data?.draw_sales),
    ticketCancels: normalizeStoredMoney(
      terminalReportResult.data?.total_cancels,
    ),
    tillCash: normalizeStoredMoney(existingReconciliation?.pos_register_total),
  };
}

function mapSaveLotteryEodRow(row: SaveLotteryEodRow) {
  return {
    reportDate: row.report_date,
    binsReconciled: row.bins_reconciled,
    scratchSales: normalizeStoredMoney(row.scratch_sales),
    terminalSales: normalizeStoredMoney(row.terminal_sales_total),
    ticketCancels: normalizeStoredMoney(row.ticket_cancels_total),
    onlineTotalPayout: normalizeStoredMoney(row.online_payout_total),
    cashingBonus: normalizeStoredMoney(row.cashing_bonus_total),
    scratchCardTotalPayout: normalizeStoredMoney(row.scratch_payout_total),
    startingFloat: normalizeStoredMoney(row.opening_cash_float),
    totalExpectedCash: normalizeStoredMoney(row.total_expected_cash),
    tillCash: normalizeStoredMoney(row.till_cash_total),
    shortOverAmount: normalizeStoredMoney(row.short_over_amount),
    discrepancyStatus: row.discrepancy_status,
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isSafeUpdateError(error: { message?: string | null }) {
  return (error.message ?? "").includes("UPDATE requires a WHERE clause");
}

function getDiscrepancyStatus(shortOverAmount: number) {
  return shortOverAmount > 0
    ? ("short" as const)
    : shortOverAmount < 0
      ? ("over" as const)
      : ("balanced" as const);
}

function calculateExpectedLotteryCash(input: {
  cashingBonus: number;
  onlineTotalPayout: number;
  scratchCardTotalPayout: number;
  scratchSalesTotal: number;
  startingFloat: number;
  terminalSales: number;
  ticketCancels: number;
}) {
  const {
    cashingBonus,
    onlineTotalPayout,
    scratchCardTotalPayout,
    scratchSalesTotal,
    startingFloat,
    terminalSales,
    ticketCancels,
  } = input;

  return roundMoney(
    Math.max(
      startingFloat +
        scratchSalesTotal +
        terminalSales -
        ticketCancels -
        onlineTotalPayout -
        scratchCardTotalPayout -
        cashingBonus,
      0,
    ),
  );
}

async function loadEodReconciliationRow(
  supabase: SupabaseServerClient,
  storeKey: string,
  businessDate: string,
): Promise<{
  data: EodReconciliationRow | null;
  error: { message?: string | null } | null;
}> {
  return supabase
    .from("eod_reconciliation")
    .select("pos_register_total,manager_notes,opening_cash_float")
    .eq("store_key", storeKey)
    .eq("report_date", businessDate)
    .maybeSingle<EodReconciliationRow>();
}

async function loadTerminalReportMarker(
  supabase: SupabaseServerClient,
  storeKey: string,
  businessDate: string,
): Promise<{
  data: { report_date: string } | null;
  error: { message?: string | null } | null;
}> {
  return supabase
    .from("terminal_reports")
    .select("report_date")
    .eq("store_key", storeKey)
    .eq("report_date", businessDate)
    .maybeSingle<{ report_date: string }>();
}

function throwDatabaseError(
  label: string,
  error: { message?: string | null },
): never {
  throw new LotteryEodReconciliationError(
    error.message ? `${label}: ${error.message}` : label,
    500,
  );
}

async function loadInventoryPack(
  supabase: SupabaseServerClient,
  storeKey: string,
  inventoryId: string,
) {
  const { data, error } = await supabase
    .from("inventory")
    .select("id,game_id,pack_number,date_activated,pack_ticket_count")
    .eq("store_key", storeKey)
    .eq("id", inventoryId)
    .maybeSingle<InventoryPackRow>();

  if (error) {
    throwDatabaseError("Failed to load scratch pack", error);
  }

  return data;
}

async function loadActiveInventoryPackForBin(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
  timeZone: string,
  binNumber: number,
) {
  const { data, error } = await supabase
    .from("inventory")
    .select("id,game_id,pack_number,date_activated,pack_ticket_count")
    .eq("store_key", storeKey)
    .eq("status", "active")
    .eq("bin_number", binNumber)
    .maybeSingle<InventoryPackRow>();

  if (error) {
    throwDatabaseError("Failed to load active scratch pack", error);
  }

  if (!data?.date_activated) {
    return data;
  }

  const activatedDate = getIsoDateKeyInTimeZone(data.date_activated, timeZone);

  if (activatedDate && activatedDate > reportDate) {
    return null;
  }

  return data;
}

async function loadHistoricalInventoryPackForBin(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
  binNumber: number,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select("inventory_id")
    .eq("store_key", storeKey)
    .eq("bin_number", binNumber)
    .lte("audit_date", reportDate)
    .not("inventory_id", "is", null)
    .order("audit_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<Array<{ inventory_id: string | null }>>();

  if (error) {
    throwDatabaseError("Failed to load scratch pack history", error);
  }

  const inventoryId = data?.[0]?.inventory_id;

  return inventoryId
    ? loadInventoryPack(supabase, storeKey, inventoryId)
    : null;
}

async function loadGameCatalogRow(
  supabase: SupabaseServerClient,
  gameId: string,
) {
  const { data, error } = await supabase
    .from("game_catalog")
    .select("game_id,ticket_count,ticket_price")
    .eq("game_id", gameId)
    .single<GameCatalogRow>();

  if (error) {
    throwDatabaseError("Failed to load scratch game catalog", error);
  }

  return data;
}

async function loadExistingEodAuditForBin(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
  binNumber: number,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select(
      "audit_id,inventory_id,bin_number,audit_date,audit_type,end_ticket_no,tickets_sold,calculated_revenue,created_at",
    )
    .eq("store_key", storeKey)
    .eq("audit_date", reportDate)
    .eq("audit_type", "eod")
    .eq("bin_number", binNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DailyAuditLookupRow>();

  if (error) {
    throwDatabaseError("Failed to load existing lottery EOD audit", error);
  }

  return data;
}

async function loadExistingEodAuditForInventory(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
  inventoryId: string,
  binNumber: number,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select(
      "audit_id,inventory_id,bin_number,audit_date,audit_type,end_ticket_no,tickets_sold,calculated_revenue,created_at",
    )
    .eq("store_key", storeKey)
    .eq("audit_date", reportDate)
    .eq("audit_type", "eod")
    .eq("inventory_id", inventoryId)
    .eq("bin_number", binNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DailyAuditLookupRow>();

  if (error) {
    throwDatabaseError("Failed to load existing lottery EOD audit", error);
  }

  return data;
}

async function loadAuditHistoryForInventory(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
  inventoryId: string,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select(
      "audit_id,inventory_id,bin_number,audit_date,audit_type,end_ticket_no,tickets_sold,calculated_revenue,created_at",
    )
    .eq("store_key", storeKey)
    .eq("inventory_id", inventoryId)
    .lte("audit_date", reportDate)
    .order("audit_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<DailyAuditLookupRow[]>();

  if (error) {
    throwDatabaseError("Failed to load scratch audit history", error);
  }

  return (data ?? []).filter(
    (audit) =>
      audit.audit_date < reportDate ||
      (audit.audit_date === reportDate &&
        coalesceAuditType(audit.audit_type) !== "eod"),
  );
}

function coalesceAuditType(auditType: string | null) {
  return auditType ?? "shift";
}

async function assertBinEntryFinalTicketBounds(input: {
  access: ScratchCardAccess;
  binEntries: NormalizedLotteryBinEntry[];
  reportDate: string;
}) {
  const { access, binEntries, reportDate } = input;

  for (const entry of binEntries) {
    const existingAudit = await loadExistingEodAuditForBin(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      entry.bin_number,
    );
    let pack = existingAudit?.inventory_id
      ? await loadInventoryPack(
          access.supabase,
          access.activeStoreKey,
          existingAudit.inventory_id,
        )
      : null;

    pack ??= await loadActiveInventoryPackForBin(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      access.activeStoreTimeZone,
      entry.bin_number,
    );
    pack ??= await loadHistoricalInventoryPackForBin(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      entry.bin_number,
    );

    if (!pack) {
      throw new LotteryEodReconciliationError(
        `No scratch pack history was found for bin ${entry.bin_number} on ${reportDate}`,
        404,
      );
    }

    const game = await loadGameCatalogRow(access.supabase, pack.game_id);
    const ticketCount = Number(
      pack.pack_ticket_count ?? game.ticket_count ?? 0,
    );

    if (!Number.isFinite(ticketCount) || ticketCount <= 0) {
      continue;
    }

    const finalTicketValue = ticketCount - 1;
    const endTicketValue = Number(entry.end_ticket_number);

    if (endTicketValue > finalTicketValue) {
      throw new LotteryEodReconciliationError(
        `Ending ticket number for bin ${entry.bin_number} cannot be greater than final ticket ${String(finalTicketValue).padStart(3, "0")}`,
        400,
      );
    }
  }
}

async function getLotteryEodBinRequirement(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
) {
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("inventory")
    .select("id,game_id,bin_number,pack_ticket_count")
    .eq("store_key", storeKey)
    .eq("status", "active")
    .not("bin_number", "is", null)
    .returns<ActiveBinRequirementInventoryRow[]>();

  if (inventoryError) {
    throwDatabaseError("Failed to load active lottery bins", inventoryError);
  }

  const activeInventory = (inventoryRows ?? []).filter(
    (
      row,
    ): row is ActiveBinRequirementInventoryRow & { bin_number: number } =>
      row.bin_number !== null,
  );

  if (activeInventory.length === 0) {
    return {
      requiredBinNumbers: new Set<number>(),
      skippedSoldOutBinNumbers: new Set<number>(),
    };
  }

  const inventoryIds = activeInventory.map((row) => row.id);
  const gameIds = Array.from(
    new Set(activeInventory.map((row) => row.game_id)),
  );
  let gameRows: ActiveBinRequirementGameRow[] = [];
  let auditRows: ActiveBinRequirementAuditRow[] = [];

  if (gameIds.length > 0) {
    const { data, error } = await supabase
      .from("game_catalog")
      .select("game_id,ticket_count")
      .in("game_id", gameIds)
      .returns<ActiveBinRequirementGameRow[]>();

    if (error) {
      throwDatabaseError("Failed to load scratch game ticket counts", error);
    }

    gameRows = data ?? [];
  }

  if (inventoryIds.length > 0) {
    const { data, error } = await supabase
      .from("daily_audits")
      .select(
        "inventory_id,start_ticket_no,end_ticket_no,tickets_sold,audit_date,created_at",
      )
      .eq("store_key", storeKey)
      .in("inventory_id", inventoryIds)
      .lte("audit_date", reportDate)
      .order("audit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<ActiveBinRequirementAuditRow[]>();

    if (error) {
      throwDatabaseError("Failed to load scratch audit history", error);
    }

    auditRows = data ?? [];
  }

  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const latestAuditByInventory = new Map<string, ActiveBinRequirementAuditRow>();

  for (const audit of auditRows) {
    if (!audit.inventory_id) {
      continue;
    }

    const current = latestAuditByInventory.get(audit.inventory_id);

    if (!current || isNewerRequirementAudit(audit, current)) {
      latestAuditByInventory.set(audit.inventory_id, audit);
    }
  }

  const requiredBinNumbers = new Set<number>();
  const skippedSoldOutBinNumbers = new Set<number>();

  for (const inventory of activeInventory) {
    const game = gameById.get(inventory.game_id);
    const ticketCount = getTicketCountFromCounts(
      inventory.pack_ticket_count,
      game?.ticket_count,
    );
    const latestAudit = latestAuditByInventory.get(inventory.id);

    if (
      isSoldOutRequirementAudit({
        audit: latestAudit,
        ticketCount,
      })
    ) {
      skippedSoldOutBinNumbers.add(inventory.bin_number);
      continue;
    }

    requiredBinNumbers.add(inventory.bin_number);
  }

  return {
    requiredBinNumbers,
    skippedSoldOutBinNumbers,
  };
}

async function getExistingEodBinCount(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select("bin_number")
    .eq("store_key", storeKey)
    .eq("audit_date", reportDate)
    .eq("audit_type", "eod")
    .not("bin_number", "is", null)
    .returns<Array<{ bin_number: number | null }>>();

  if (error) {
    throwDatabaseError("Failed to count existing lottery EOD bins", error);
  }

  return new Set((data ?? []).map((row) => row.bin_number)).size;
}

async function getExistingEodBinNumbers(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select("bin_number")
    .eq("store_key", storeKey)
    .eq("audit_date", reportDate)
    .eq("audit_type", "eod")
    .not("bin_number", "is", null)
    .returns<Array<{ bin_number: number | null }>>();

  if (error) {
    throwDatabaseError("Failed to load existing lottery EOD bins", error);
  }

  return new Set(
    (data ?? [])
      .map((row) => row.bin_number)
      .filter((binNumber): binNumber is number => binNumber !== null),
  );
}

function formatBinList(binNumbers: number[]) {
  return binNumbers
    .sort((left, right) => left - right)
    .map((binNumber) => `Bin ${binNumber}`)
    .join(", ");
}

function assertBinEntryAccountability(input: {
  allowUnexpectedBinNumbers?: boolean;
  allowUntrackedWhenNoRequired?: boolean;
  binEntries: NormalizedLotteryBinEntry[];
  requiredBinNumbers: Set<number>;
  scopeLabel: string;
}) {
  const {
    allowUnexpectedBinNumbers = false,
    allowUntrackedWhenNoRequired = false,
    binEntries,
    requiredBinNumbers,
    scopeLabel,
  } = input;

  if (
    requiredBinNumbers.size === 0 &&
    (allowUntrackedWhenNoRequired || binEntries.length === 0)
  ) {
    return;
  }

  const submittedBinNumbers = new Set(
    binEntries.map((entry) => entry.bin_number),
  );
  const missingBinNumbers = Array.from(requiredBinNumbers).filter(
    (binNumber) => !submittedBinNumbers.has(binNumber),
  );
  const unexpectedBinNumbers = Array.from(submittedBinNumbers).filter(
    (binNumber) => !requiredBinNumbers.has(binNumber),
  );

  if (missingBinNumbers.length > 0) {
    throw new LotteryEodReconciliationError(
      `Enter ending ticket numbers for ${formatBinList(missingBinNumbers)} before saving ${scopeLabel}`,
      400,
    );
  }

  if (!allowUnexpectedBinNumbers && unexpectedBinNumbers.length > 0) {
    const subject = formatBinList(unexpectedBinNumbers);

    throw new LotteryEodReconciliationError(
      unexpectedBinNumbers.length === 1
        ? `Remove ${subject}; it is not part of ${scopeLabel}`
        : `Remove ${subject}; they are not part of ${scopeLabel}`,
      400,
    );
  }
}

async function assertLotteryEodBinAccountability(input: {
  access: ScratchCardAccess;
  reportDate: string;
  binEntries: NormalizedLotteryBinEntry[];
}): Promise<LotteryEodBinAccountability> {
  const { access, reportDate, binEntries } = input;
  const todayDate = getTodayIsoDate(access.activeStoreTimeZone);

  if (reportDate === todayDate) {
    const binRequirement = await getLotteryEodBinRequirement(
      access.supabase,
      access.activeStoreKey,
      reportDate,
    );

    assertBinEntryAccountability({
      binEntries,
      requiredBinNumbers: binRequirement.requiredBinNumbers,
      scopeLabel: "today's Lottery EOD",
    });

    return {
      skippedSoldOutBinNumbers: binRequirement.skippedSoldOutBinNumbers,
    };
  }

  const existingEodBinNumbers = await getExistingEodBinNumbers(
    access.supabase,
    access.activeStoreKey,
    reportDate,
  );

  assertBinEntryAccountability({
    allowUnexpectedBinNumbers: true,
    allowUntrackedWhenNoRequired: true,
    binEntries,
    requiredBinNumbers: existingEodBinNumbers,
    scopeLabel: `Lottery EOD for ${reportDate}`,
  });

  return {
    skippedSoldOutBinNumbers: new Set<number>(),
  };
}

async function assertLotteryEodCanBeSubmitted(
  access: ScratchCardAccess,
  reportDate: string,
): Promise<LotteryEodSubmissionState> {
  const [reconciliationResult, terminalReportResult] = await Promise.all([
    loadEodReconciliationRow(
      access.supabase,
      access.activeStoreKey,
      reportDate,
    ),
    loadTerminalReportMarker(
      access.supabase,
      access.activeStoreKey,
      reportDate,
    ),
  ]);
  const error = reconciliationResult.error ?? terminalReportResult.error;

  if (error) {
    throwDatabaseError(
      "Failed to check existing lottery reconciliation",
      error,
    );
  }

  const state = {
    hasExistingReconciliation: Boolean(reconciliationResult.data),
    hasTerminalReport: Boolean(terminalReportResult.data),
  };

  if (state.hasTerminalReport && access.currentUserRole !== "admin") {
    throw new LotteryEodReconciliationError(
      "Lottery EOD reconciliation is already saved for this date",
      409,
    );
  }

  return state;
}

async function upsertLotteryEodAudit(input: {
  supabase: SupabaseServerClient;
  storeKey: string;
  reportDate: string;
  employeeId: string;
  inventoryId: string;
  binNumber: number;
  startTicket: string;
  endTicket: string;
  ticketsSold: number;
  calculatedRevenue: number;
}) {
  const {
    supabase,
    storeKey,
    reportDate,
    employeeId,
    inventoryId,
    binNumber,
    startTicket,
    endTicket,
    ticketsSold,
    calculatedRevenue,
  } = input;
  const existingAudit = await loadExistingEodAuditForInventory(
    supabase,
    storeKey,
    reportDate,
    inventoryId,
    binNumber,
  );

  if (!existingAudit) {
    const { data, error } = await supabase
      .from("daily_audits")
      .insert({
        store_key: storeKey,
        audit_date: reportDate,
        employee_id: employeeId,
        inventory_id: inventoryId,
        bin_number: binNumber,
        start_ticket_no: startTicket,
        end_ticket_no: endTicket,
        tickets_sold: ticketsSold,
        calculated_revenue: calculatedRevenue,
        audit_type: "eod",
      })
      .select("audit_id")
      .single<{ audit_id: string }>();

    if (error) {
      throwDatabaseError("Failed to insert lottery EOD audit", error);
    }

    return data.audit_id;
  }

  const { data, error } = await supabase
    .from("daily_audits")
    .update({
      employee_id: employeeId,
      start_ticket_no: startTicket,
      end_ticket_no: endTicket,
      tickets_sold: ticketsSold,
      calculated_revenue: calculatedRevenue,
      updated_at: new Date().toISOString(),
    })
    .eq("audit_id", existingAudit.audit_id)
    .select("audit_id")
    .single<{ audit_id: string }>();

  if (error) {
    throwDatabaseError("Failed to update lottery EOD audit", error);
  }

  return data.audit_id;
}

async function deleteDuplicateLotteryEodAudits(input: {
  supabase: SupabaseServerClient;
  storeKey: string;
  reportDate: string;
  inventoryId: string;
  binNumber: number;
  keptAuditId: string;
}) {
  const {
    supabase,
    storeKey,
    reportDate,
    inventoryId,
    binNumber,
    keptAuditId,
  } = input;
  const { error } = await supabase
    .from("daily_audits")
    .delete()
    .eq("store_key", storeKey)
    .eq("audit_date", reportDate)
    .eq("audit_type", "eod")
    .eq("inventory_id", inventoryId)
    .eq("bin_number", binNumber)
    .neq("audit_id", keptAuditId);

  if (error) {
    throwDatabaseError("Failed to remove duplicate lottery EOD audits", error);
  }
}

async function calculateScratchSalesTotal(
  supabase: SupabaseServerClient,
  storeKey: string,
  reportDate: string,
) {
  const { data, error } = await supabase
    .from("daily_audits")
    .select("calculated_revenue")
    .eq("store_key", storeKey)
    .eq("audit_date", reportDate)
    .returns<Array<{ calculated_revenue: number | string | null }>>();

  if (error) {
    throwDatabaseError("Failed to calculate scratch sales", error);
  }

  return roundMoney(
    (data ?? []).reduce(
      (total, audit) => total + normalizeStoredMoney(audit.calculated_revenue),
      0,
    ),
  );
}

function isMissingLotteryBondingFeeColumnError(error: {
  message?: string | null;
}) {
  return (error.message ?? "").toLowerCase().includes("lottery_bonding_fee");
}

async function saveLotteryBondingFeeForDate(input: {
  access: ScratchCardAccess;
  lotteryBondFee: number;
  reportDate: string;
}) {
  const { access, lotteryBondFee, reportDate } = input;
  const { error } = await access.supabase.from("terminal_reports").upsert(
    {
      store_key: access.activeStoreKey,
      report_date: reportDate,
      lottery_bonding_fee: roundMoney(lotteryBondFee),
      created_by: access.currentUser.id,
    },
    {
      onConflict: "store_key,report_date",
    },
  );

  if (!error) {
    return;
  }

  if (isMissingLotteryBondingFeeColumnError(error)) {
    throw new LotteryEodReconciliationError(
      "Apply the latest Supabase migration before saving lottery bond fee.",
      500,
    );
  }

  throwDatabaseError("Failed to save lottery bond fee", error);
}

async function saveLotteryEodWithClientFallback(input: {
  access: ScratchCardAccess;
  reportDate: string;
  binEntries: NormalizedLotteryBinEntry[];
  terminalSales: number;
  ticketCancels: number;
  lotteryBondFee: number;
  onlineTotalPayout: number;
  scratchCardTotalPayout: number;
  cashingBonus: number;
  startingFloat: number;
  tillCash: number;
  managerNotes: string;
}) {
  const {
    access,
    reportDate,
    binEntries,
    terminalSales,
    ticketCancels,
    lotteryBondFee,
    onlineTotalPayout,
    scratchCardTotalPayout,
    cashingBonus,
    startingFloat,
    tillCash,
    managerNotes,
  } = input;
  const todayDate = getTodayIsoDate(access.activeStoreTimeZone);
  const todayBinRequirement =
    reportDate === todayDate
      ? await getLotteryEodBinRequirement(
          access.supabase,
          access.activeStoreKey,
          reportDate,
        )
      : null;
  const existingEodBinCount =
    reportDate !== todayDate
      ? await getExistingEodBinCount(
          access.supabase,
          access.activeStoreKey,
          reportDate,
        )
      : 0;

  if (
    todayBinRequirement &&
    todayBinRequirement.requiredBinNumbers.size > binEntries.length
  ) {
    throw new LotteryEodReconciliationError(
      "Enter ending ticket numbers for every bin that is not sold out",
      400,
    );
  }

  if (reportDate !== todayDate && existingEodBinCount > binEntries.length) {
    throw new LotteryEodReconciliationError(
      `Enter ending ticket numbers for every bin already reconciled on ${reportDate}`,
      400,
    );
  }

  let reconciledBinCount = 0;

  for (const entry of binEntries) {
    const existingAudit = await loadExistingEodAuditForBin(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      entry.bin_number,
    );
    let pack = existingAudit?.inventory_id
      ? await loadInventoryPack(
          access.supabase,
          access.activeStoreKey,
          existingAudit.inventory_id,
        )
      : null;

    pack ??= await loadActiveInventoryPackForBin(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      access.activeStoreTimeZone,
      entry.bin_number,
    );
    pack ??= await loadHistoricalInventoryPackForBin(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      entry.bin_number,
    );

    if (!pack) {
      throw new LotteryEodReconciliationError(
        `No scratch pack history was found for bin ${entry.bin_number} on ${reportDate}`,
        404,
      );
    }

    const game = await loadGameCatalogRow(access.supabase, pack.game_id);
    const ticketLimit = Number(game.ticket_count ?? 0);
    const ticketPrice = normalizeStoredMoney(game.ticket_price);
    const endTicketValue = Number(entry.end_ticket_number);
    const finalTicketValue = ticketLimit > 0 ? ticketLimit - 1 : 0;

    if (ticketLimit > 0 && endTicketValue > finalTicketValue) {
      throw new LotteryEodReconciliationError(
        `Ending ticket number for bin ${entry.bin_number} cannot be greater than final ticket ${String(finalTicketValue).padStart(3, "0")}`,
        400,
      );
    }

    const priorAudits = await loadAuditHistoryForInventory(
      access.supabase,
      access.activeStoreKey,
      reportDate,
      pack.id,
    );
    let startTicket = priorAudits[0]?.end_ticket_no ?? "000";
    let startTicketValue = Number(startTicket);
    const hasPriorSoldAudit = priorAudits.some(
      (audit) =>
        normalizeStoredMoney(audit.tickets_sold) > 0 ||
        normalizeStoredMoney(audit.calculated_revenue) > 0,
    );
    const resetAllowed = Boolean(pack.date_activated) && !hasPriorSoldAudit;

    if (endTicketValue < startTicketValue) {
      if (!resetAllowed) {
        throw new LotteryEodReconciliationError(
          `Ending ticket number for bin ${entry.bin_number} cannot be lower than its starting ticket number unless a new pack was activated`,
          400,
        );
      }

      startTicket = "000";
      startTicketValue = 0;
    }

    const ticketsSold = endTicketValue - startTicketValue;
    const calculatedRevenue = roundMoney(ticketsSold * ticketPrice);
    const auditId = await upsertLotteryEodAudit({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      reportDate,
      employeeId: access.currentUser.id,
      inventoryId: pack.id,
      binNumber: entry.bin_number,
      startTicket,
      endTicket: entry.end_ticket_number,
      ticketsSold,
      calculatedRevenue,
    });

    await deleteDuplicateLotteryEodAudits({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      reportDate,
      inventoryId: pack.id,
      binNumber: entry.bin_number,
      keptAuditId: auditId,
    });

    reconciledBinCount += 1;
  }

  const scratchSalesTotal = await calculateScratchSalesTotal(
    access.supabase,
    access.activeStoreKey,
    reportDate,
  );
  const cashAdvanceSummary = await loadLotteryCashAdvanceSummary({
    supabase: access.supabase,
    storeKey: access.activeStoreKey,
    businessDate: reportDate,
  });
  const expectedCashTotal = calculateExpectedLotteryCash({
    cashingBonus,
    onlineTotalPayout,
    scratchCardTotalPayout,
    scratchSalesTotal,
    startingFloat,
    terminalSales,
    ticketCancels,
  });
  const shortOverTotal = roundMoney(expectedCashTotal - tillCash);
  const discrepancyStatus = getDiscrepancyStatus(shortOverTotal);
  const notes = managerNotes.trim() || null;

  const terminalReport = await access.supabase.from("terminal_reports").upsert(
    {
      store_key: access.activeStoreKey,
      report_date: reportDate,
      draw_sales: roundMoney(terminalSales),
      draw_payouts: roundMoney(onlineTotalPayout),
      scratch_payouts: roundMoney(scratchCardTotalPayout),
      total_cashing_bonus: roundMoney(cashingBonus),
      total_cancels: roundMoney(ticketCancels),
      lottery_bonding_fee: roundMoney(lotteryBondFee),
      created_by: access.currentUser.id,
    },
    { onConflict: "store_key,report_date" },
  );

  if (terminalReport.error) {
    throwDatabaseError("Failed to save terminal report", terminalReport.error);
  }

  const reconciliationPayload = {
    store_key: access.activeStoreKey,
    report_date: reportDate,
    opening_cash_float: roundMoney(startingFloat),
    closing_cash_float: 0,
    total_expected_cash: expectedCashTotal,
    pos_register_total: roundMoney(tillCash),
    manager_notes: notes,
    created_by: access.currentUser.id,
  };
  const reconciliation = await access.supabase
    .from("eod_reconciliation")
    .upsert(reconciliationPayload, { onConflict: "store_key,report_date" });

  if (reconciliation.error) {
    throwDatabaseError(
      "Failed to save lottery reconciliation",
      reconciliation.error,
    );
  }

  const savedResult = mapSaveLotteryEodRow({
    report_date: reportDate,
    bins_reconciled: reconciledBinCount,
    scratch_sales: scratchSalesTotal,
    terminal_sales_total: roundMoney(terminalSales),
    ticket_cancels_total: roundMoney(ticketCancels),
    online_payout_total: roundMoney(onlineTotalPayout),
    scratch_payout_total: roundMoney(scratchCardTotalPayout),
    cashing_bonus_total: roundMoney(cashingBonus),
    opening_cash_float: roundMoney(startingFloat),
    total_expected_cash: expectedCashTotal,
    till_cash_total: roundMoney(tillCash),
    short_over_amount: shortOverTotal,
    discrepancy_status: discrepancyStatus,
  });
  return {
    ...savedResult,
    lotteryBondFee: roundMoney(lotteryBondFee),
    lotteryCashAdvanceNetImpact: cashAdvanceSummary.dailyNetCashImpact,
    lotteryCashAdvancesTaken: cashAdvanceSummary.dailyAdvanceTotal,
    lotteryCashPaybacksReceived: cashAdvanceSummary.dailyPaybackTotal,
  };
}

export async function submitLotteryEodReconciliation(
  access: ScratchCardAccess,
  payload: LotteryEodReconciliationPayload,
) {
  const todayDate = getTodayIsoDate(access.activeStoreTimeZone);
  const reportDate = normalizeDate(payload.date, todayDate);
  assertAdminBackdateAccess(access, reportDate);
  const submissionState = await assertLotteryEodCanBeSubmitted(
    access,
    reportDate,
  );
  const binEntries = normalizeBinEntries(payload.binEntries);
  const binAccountability = await assertLotteryEodBinAccountability({
    access,
    reportDate,
    binEntries,
  });
  await assertBinEntryFinalTicketBounds({
    access,
    binEntries,
    reportDate,
  });
  const terminalSales = normalizeMoney(payload.terminalSales, "Terminal sales");
  const ticketCancels = normalizeMoney(
    payload.ticketCancels ?? 0,
    "Ticket cancels",
  );
  const onlineTotalPayout = normalizeMoney(
    payload.onlineTotalPayout,
    "Online total payout",
  );
  const cashingBonus = normalizeMoney(payload.cashingBonus ?? 0, "PROMO");
  const lotteryBondFee = normalizeMoney(
    payload.lotteryBondFee ?? 0,
    "Lottery bond fee",
  );
  const scratchCardTotalPayout = normalizeMoney(
    payload.scratchCardTotalPayout,
    "Scratch card total payout",
  );
  const startingFloat = normalizeMoney(
    payload.startingFloat ?? 0,
    "Starting float",
  );
  const tillCash = normalizeMoney(payload.tillCash, "Lottery cash counted");
  const managerNotes = normalizeString(payload.managerNotes);

  if (
    reportDate !== todayDate ||
    binAccountability.skippedSoldOutBinNumbers.size > 0 ||
    (submissionState.hasExistingReconciliation &&
      !submissionState.hasTerminalReport)
  ) {
    return saveLotteryEodWithClientFallback({
      access,
      reportDate,
      binEntries,
      terminalSales,
      ticketCancels,
      lotteryBondFee,
      onlineTotalPayout,
      scratchCardTotalPayout,
      cashingBonus,
      startingFloat,
      tillCash,
      managerNotes,
    });
  }

  const rpcPayload = {
    bin_entries: binEntries,
    manager_notes: managerNotes || null,
    online_total_payout: onlineTotalPayout,
    cashing_bonus: cashingBonus,
    reconciled_by: access.currentUser.id,
    scratch_card_total_payout: scratchCardTotalPayout,
    target_report_date: reportDate,
    target_store_key: access.activeStoreKey,
    terminal_sales: terminalSales,
    ticket_cancels: ticketCancels,
    till_cash: tillCash,
  };
  const { data, error } = await access.supabase.rpc(
    "save_lottery_eod_reconciliation",
    rpcPayload,
  );

  if (error) {
    if (isSafeUpdateError(error)) {
      return saveLotteryEodWithClientFallback({
        access,
        reportDate,
        binEntries,
        terminalSales,
        ticketCancels,
        lotteryBondFee,
        onlineTotalPayout,
        scratchCardTotalPayout,
        cashingBonus,
        startingFloat,
        tillCash,
        managerNotes,
      });
    }

    throw mapRpcError(error);
  }

  const row = getSingleRpcRow(data as SaveLotteryEodRow[] | null);
  await saveLotteryBondingFeeForDate({
    access,
    lotteryBondFee,
    reportDate,
  });
  const savedResult = mapSaveLotteryEodRow(row);
  const cashAdvanceSummary = await loadLotteryCashAdvanceSummary({
    supabase: access.supabase,
    storeKey: access.activeStoreKey,
    businessDate: reportDate,
  });
  const totalExpectedCash = calculateExpectedLotteryCash({
    cashingBonus,
    onlineTotalPayout,
    scratchCardTotalPayout,
    scratchSalesTotal: savedResult.scratchSales,
    startingFloat,
    terminalSales,
    ticketCancels,
  });
  const shortOverAmount = roundMoney(totalExpectedCash - tillCash);
  const reconciliation = await access.supabase
    .from("eod_reconciliation")
    .upsert(
      {
        store_key: access.activeStoreKey,
        report_date: reportDate,
        opening_cash_float: roundMoney(startingFloat),
        closing_cash_float: 0,
        total_expected_cash: totalExpectedCash,
        pos_register_total: roundMoney(tillCash),
        manager_notes: managerNotes.trim() || null,
        created_by: access.currentUser.id,
      },
      { onConflict: "store_key,report_date" },
    );

  if (reconciliation.error) {
    throwDatabaseError(
      "Failed to save lottery starting float",
      reconciliation.error,
    );
  }

  return {
    ...savedResult,
    discrepancyStatus: getDiscrepancyStatus(shortOverAmount),
    lotteryBondFee,
    lotteryCashAdvanceNetImpact: cashAdvanceSummary.dailyNetCashImpact,
    lotteryCashAdvancesTaken: cashAdvanceSummary.dailyAdvanceTotal,
    lotteryCashPaybacksReceived: cashAdvanceSummary.dailyPaybackTotal,
    shortOverAmount,
    startingFloat: roundMoney(startingFloat),
    totalExpectedCash,
  };
}
