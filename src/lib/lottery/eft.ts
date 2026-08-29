import {
  addDaysToIsoDateKey,
  enumerateIsoDateRange,
  getIsoDateKeyInTimeZone,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import { unstable_noStore as noStore } from "next/cache";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";
import type { ScratchCardAccess } from "@/lib/scratch-cards/api";
import { calculateLotteryEodScratchSales } from "./cash";
import { calculateLotteryEftFormula } from "./eft-calculation";
import {
  calculateAppliedLotteryEftPayment,
  normalizeOptionalLotteryEftPaidAmount,
} from "./eft-paid-amount";
import {
  getLotteryEftSweepDateForReportDate,
  getLatestLotteryEftSweepDate,
  getLotteryEftSweepPeriod,
  getLotteryEftSweepPeriods,
  isLotteryEftSweepDate,
  resolveLotteryEftSelectedSweepDate,
} from "./eft-periods";
import {
  buildScratchPackSettlementSales,
  SCRATCH_EFT_ACTIVE_29_DAY_SETTLEMENT_AUDIT_TYPE,
  SCRATCH_EFT_SETTLEMENT_AUDIT_TYPE,
  SCRATCH_EFT_SETTLEMENT_REVERSAL_AUDIT_TYPE,
  isScratchEftActive29DaySettlementAudit,
  isScratchEftSettlementAudit,
  isScratchEftSettlementReversalAudit,
  sumScratchPackSettlementsByDate,
  type ScratchPackSettlementSale,
  type ScratchSettlementAuditRow,
  type ScratchSettlementGameRow,
  type ScratchSettlementInventoryRow,
} from "./scratch-pack-settlements";

type DailyAuditRow = {
  audit_type: string | null;
  audit_date: string;
  calculated_revenue: number | string | null;
};

type TerminalReportRow = {
  draw_payouts: number | string;
  draw_sales: number | string;
  lottery_bonding_fee?: number | string | null;
  report_date: string;
  scratch_payouts: number | string;
  scratch_returns: number | string;
  total_cashing_bonus: number | string;
  total_cancels: number | string;
};

type ActiveInventoryRow = {
  id: string;
  bin_number: number | null;
  created_at: string;
  date_activated: string | null;
  date_received: string | null;
  game_id: string;
  pack_id: string | null;
  pack_number: string;
  pack_ticket_count: number | null;
};

type GameCatalogRow = {
  game_id: string;
  game_name: string;
  ticket_count: number | null;
  ticket_price: number | string;
};

type InventoryAuditRow = {
  audit_id?: string;
  audit_date: string;
  audit_type: string | null;
  bin_number?: number | null;
  created_at: string;
  end_ticket_no: string | null;
  inventory_id: string | null;
};

type SoldOutPackInventoryRow = {
  bin_number: number | null;
  date_activated: string | null;
  game_id: string;
  id: string;
  pack_number: string;
  pack_ticket_count: number | string | null;
  status: string;
  updated_at: string;
};

type SoldOutPackGameRow = {
  game_id: string;
  game_name: string | null;
  ticket_count: number | string | null;
  ticket_price: number | string | null;
};

type EftWeeklyStatusRow = {
  marked_by: string | null;
  markedByName?: string | null;
  paid_at: string | null;
  paid_amount?: number | string | null;
  paid_notes?: string | null;
  paid_reference?: string | null;
  status: LotteryEftPaymentStatus;
  sweep_date: string;
  week_end_date: string;
  week_start_date: string;
};

type ProfileNameRow = {
  id: string;
  email: string | null;
  full_name: string | null;
};

export type LotteryEftPaymentStatus = "paid" | "unpaid";

export type LotteryEftDailyRow = {
  administrativeFees: number;
  bondingFee: number;
  cashingBonusCredit: number;
  drawPayouts: number;
  drawSales: number;
  expectedCash: number;
  grossSales: number;
  netEftDue: number;
  netTicketSales: number;
  promoCredits: number;
  reportDate: string;
  retailerCommissionCredit: number;
  scratchPayouts: number;
  scratchReturns: number;
  scratchSales: number;
  settledPackSales: number;
  ticketCancels: number;
  totalCommissions: number;
  totalCredits: number;
  totalPayouts: number;
  status: "credit" | "due" | "pending" | "zero";
};

export type LotteryEftTransactionRow = {
  amount: number;
  category:
    | "bonus"
    | "cancel"
    | "commission"
    | "due"
    | "fee"
    | "payout"
    | "promo"
    | "return"
    | "sale";
  effect: "add" | "net" | "subtract";
  label: string;
  reportDate: string;
};

export type LotteryEftSummary = {
  administrativeFees: number;
  bondingFee: number;
  cashingBonusCredit: number;
  grossSales: number;
  netEftDue: number;
  netTicketSales: number;
  promoCredits: number;
  openDays: number;
  retailerCommissionCredit: number;
  settledPackSales: number;
  totalCommissions: number;
  totalCredits: number;
  totalPayouts: number;
};

export type LotteryEftWeeklyLedgerRow = LotteryEftSummary & {
  appliedPaidAmount: number;
  markedBy: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  paidNotes: string | null;
  paidReference: string | null;
  paymentStatus: LotteryEftPaymentStatus;
  sweepDate: string;
  weekEndDate: string;
  weekStartDate: string;
};

export type LotteryEftWeeklySummary = {
  paidNetEftDue: number;
  paidWeeks: number;
  totalExpectedCash: number;
  totalNetEftDue: number;
  unpaidNetEftDue: number;
  unpaidWeeks: number;
};

export type LotteryEftSweepReason = "age" | "depletion";

export type LotteryEftThursdaySweepPack = {
  binNumber: number | null;
  dateActivated: string | null;
  dateReceived: string | null;
  daysInSystem: number;
  depletionPercent: number | null;
  gameId: string;
  gameName: string;
  inventoryId: string;
  latestAuditAt: string | null;
  latestTicketNumber: string | null;
  packId: string;
  packNumber: string;
  packValue: number | null;
  reasons: LotteryEftSweepReason[];
  ticketCount: number | null;
  ticketPrice: number;
};

export type LotteryEftThursdaySweep = {
  agedPackCount: number;
  depletedPackCount: number;
  packs: LotteryEftThursdaySweepPack[];
  paymentStatus: LotteryEftPaymentStatus;
  sweepDate: string | null;
  totalPackValue: number;
  weekEndDate: string | null;
  weekStartDate: string | null;
};

export type LotteryEftSoldOutPackStatus =
  | "included-other"
  | "included-selected"
  | "pending";

export type LotteryEftSettlementPackReason = "active_29_day" | "sold_out";

export type LotteryEftSoldOutPackRow = {
  activatedDate: string | null;
  binNumber: number | null;
  dueDate: string;
  gameId: string;
  gameName: string;
  hasSoldOutAudit: boolean;
  includedAuditId: string | null;
  includedDate: string | null;
  includedInSelectedEft: boolean;
  inventoryId: string;
  inventoryStatus: string;
  packNumber: string;
  packValue: number | null;
  pendingReason: LotteryEftSettlementPackReason;
  reversalAuditId: string | null;
  reversedDate: string | null;
  soldOutAuditType: string | null;
  soldOutDate: string | null;
  status: LotteryEftSoldOutPackStatus;
  ticketCount: number | null;
  ticketPrice: number;
};

export type LotteryEftData = {
  dailyRows: LotteryEftDailyRow[];
  endDate: string;
  errorMessage?: string;
  latestSweepDate: string;
  retailerCommissionRate: number;
  cashingBonusRate: number;
  selectedSweepDate: string;
  source: "database" | "error" | "unconfigured";
  startDate: string;
  statusLedgerAvailable: boolean;
  storeKey: string;
  summary: LotteryEftSummary;
  soldOutPacks: LotteryEftSoldOutPackRow[];
  thursdaySweep: LotteryEftThursdaySweep;
  transactions: LotteryEftTransactionRow[];
  weekEndDate: string;
  weekStartDate: string;
  weeklyLedger: LotteryEftWeeklyLedgerRow[];
  weeklySummary: LotteryEftWeeklySummary;
  weeks: number;
};

type LoadLotteryEftOptions = {
  ledgerEndSweepDate?: string;
  sweepDate?: string;
  weeks?: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const DEFAULT_EFT_WEEKS = 8;
const MAX_EFT_WEEKS = 52;
const ACTIVE_PACK_EFT_SETTLEMENT_AGE_DAYS = 29;
const THURSDAY_SWEEP_AGE_DAYS = ACTIVE_PACK_EFT_SETTLEMENT_AGE_DAYS;
const THURSDAY_SWEEP_DEPLETION_PERCENT = 80;
const SETTLEMENT_AUDIT_PAGE_SIZE = 1000;

export class LotteryEftWorkflowError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LotteryEftWorkflowError";
    this.status = status;
  }
}

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

function normalizeWeeks(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_EFT_WEEKS;
  }

  return Math.min(
    Math.max(Math.trunc(value ?? DEFAULT_EFT_WEEKS), 1),
    MAX_EFT_WEEKS,
  );
}

function normalizePaymentStatus(value: unknown): LotteryEftPaymentStatus {
  if (value === "paid" || value === "unpaid") {
    return value;
  }

  throw new LotteryEftWorkflowError("EFT status must be paid or unpaid", 400);
}

function parseRequiredPaidAmount(value: unknown) {
  const paidAmount = normalizeOptionalLotteryEftPaidAmount(
    typeof value === "number" || typeof value === "string" ? value : null,
  );

  if (paidAmount === null) {
    throw new LotteryEftWorkflowError(
      "Paid amount is required when marking EFT paid",
      400,
    );
  }

  return paidAmount;
}

function normalizeOptionalEvidenceText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function buildEmptySummary(): LotteryEftSummary {
  return {
    administrativeFees: 0,
    bondingFee: 0,
    cashingBonusCredit: 0,
    grossSales: 0,
    netEftDue: 0,
    netTicketSales: 0,
    promoCredits: 0,
    openDays: 0,
    retailerCommissionCredit: 0,
    settledPackSales: 0,
    totalCommissions: 0,
    totalCredits: 0,
    totalPayouts: 0,
  };
}

function buildEmptyThursdaySweep(): LotteryEftThursdaySweep {
  return {
    agedPackCount: 0,
    depletedPackCount: 0,
    packs: [],
    paymentStatus: "unpaid",
    sweepDate: null,
    totalPackValue: 0,
    weekEndDate: null,
    weekStartDate: null,
  };
}

function buildEmptyWeeklySummary(): LotteryEftWeeklySummary {
  return {
    paidNetEftDue: 0,
    paidWeeks: 0,
    totalExpectedCash: 0,
    totalNetEftDue: 0,
    unpaidNetEftDue: 0,
    unpaidWeeks: 0,
  };
}

function getDaysSince(value: string | null | undefined, endDate: string) {
  if (!value) {
    return 0;
  }

  const start = new Date(value);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 86_400_000),
  );
}

function getDateKeyForStore(
  value: string | null | undefined,
  timeZone: string,
) {
  if (!value) {
    return null;
  }

  return getIsoDateKeyInTimeZone(value, timeZone) ?? value.slice(0, 10);
}

function getActivePackSettlementDueDate({
  dateActivated,
  timeZone,
}: {
  dateActivated: string | null | undefined;
  timeZone: string;
}) {
  const activatedDate = getDateKeyForStore(dateActivated, timeZone);

  return activatedDate
    ? addDaysToIsoDateKey(activatedDate, ACTIVE_PACK_EFT_SETTLEMENT_AGE_DAYS)
    : null;
}

function normalizeTicketNumber(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!/^[0-9]{1,3}$/.test(normalized)) {
    return null;
  }

  return String(Number(normalized)).padStart(3, "0");
}

function normalizeTicketCount(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return Math.trunc(normalized);
}

function isDateInRange(dateKey: string, startDate: string, endDate: string) {
  return dateKey >= startDate && dateKey <= endDate;
}

function getFinalTicketNumber(ticketCount: number | null) {
  if (!ticketCount) {
    return null;
  }

  return String(ticketCount - 1).padStart(3, "0");
}

function hasReachedFinalTicket(
  audit: ScratchSettlementAuditRow,
  ticketCount: number | null,
) {
  const finalTicketNumber = getFinalTicketNumber(ticketCount);
  const endTicketNumber = normalizeTicketNumber(audit.end_ticket_no);

  return Boolean(
    finalTicketNumber &&
      endTicketNumber &&
      endTicketNumber >= finalTicketNumber,
  );
}

function getScratchEftSettlementState(
  auditRows: ScratchSettlementAuditRow[],
  ticketCount: number | null,
) {
  let soldOutAudit: ScratchSettlementAuditRow | null = null;
  let activeIncludedAudit: ScratchSettlementAuditRow | null = null;
  let latestReversalAudit: ScratchSettlementAuditRow | null = null;
  const chronologicalAuditRows = [...auditRows].sort(
    (left, right) =>
      left.audit_date.localeCompare(right.audit_date) ||
      left.created_at.localeCompare(right.created_at),
  );

  for (const audit of chronologicalAuditRows) {
    const isActiveSettlement = isScratchEftActive29DaySettlementAudit(
      audit.audit_type,
    );
    const isSoldOutSettlement = isScratchEftSettlementAudit(audit.audit_type);
    const isReversal = isScratchEftSettlementReversalAudit(audit.audit_type);
    const reachedFinalTicket = hasReachedFinalTicket(audit, ticketCount);

    if (!soldOutAudit && reachedFinalTicket && !isReversal) {
      soldOutAudit = audit;
    }

    if (isActiveSettlement || isSoldOutSettlement) {
      activeIncludedAudit = audit;
      continue;
    }

    if (isReversal) {
      activeIncludedAudit = null;
      latestReversalAudit = audit;
    }
  }

  return {
    activeIncludedAudit,
    latestReversalAudit,
    soldOutAudit,
  };
}

function getLatestAuditByInventory(auditRows: InventoryAuditRow[]) {
  const latestByInventory = new Map<string, InventoryAuditRow>();

  for (const audit of auditRows) {
    if (!audit.inventory_id) {
      continue;
    }

    if (
      isScratchEftSettlementAudit(audit.audit_type) ||
      isScratchEftActive29DaySettlementAudit(audit.audit_type) ||
      isScratchEftSettlementReversalAudit(audit.audit_type)
    ) {
      continue;
    }

    const current = latestByInventory.get(audit.inventory_id);

    if (
      !current ||
      audit.audit_date > current.audit_date ||
      (audit.audit_date === current.audit_date &&
        audit.created_at > current.created_at)
    ) {
      latestByInventory.set(audit.inventory_id, audit);
    }
  }

  return latestByInventory;
}

function buildThursdaySweep({
  auditRows,
  endDate,
  gameRows,
  inventoryRows,
  paymentStatus,
  startDate,
  sweepDate,
}: {
  auditRows: InventoryAuditRow[];
  endDate: string;
  gameRows: GameCatalogRow[];
  inventoryRows: ActiveInventoryRow[];
  paymentStatus: LotteryEftPaymentStatus;
  startDate: string;
  sweepDate: string;
}): LotteryEftThursdaySweep {
  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const latestAuditByInventory = getLatestAuditByInventory(auditRows);
  const auditsByInventory = auditRows.reduce((byInventory, audit) => {
    if (!audit.inventory_id) {
      return byInventory;
    }

    byInventory.set(audit.inventory_id, [
      ...(byInventory.get(audit.inventory_id) ?? []),
      audit,
    ]);

    return byInventory;
  }, new Map<string, ScratchSettlementAuditRow[]>());
  const packs = inventoryRows.flatMap((inventory) => {
    const game = gameById.get(inventory.game_id);
    const latestAudit = latestAuditByInventory.get(inventory.id);
    const dateReceived = inventory.date_received ?? inventory.created_at;
    const daysInSystem = getDaysSince(inventory.date_activated, endDate);
    const ticketCount = game?.ticket_count ?? null;
    const latestTicketNumber = normalizeTicketNumber(
      latestAudit?.end_ticket_no,
    );
    const depletionPercent =
      ticketCount && latestTicketNumber
        ? Math.round((Number(latestTicketNumber) / ticketCount) * 1000) / 10
        : null;
    const ticketPrice = normalizeMoney(game?.ticket_price);
    const packValue = ticketCount
      ? normalizeMoney(ticketPrice * ticketCount)
      : null;
    const reasons: LotteryEftSweepReason[] = [];
    const { activeIncludedAudit } = getScratchEftSettlementState(
      auditsByInventory.get(inventory.id) ?? [],
      ticketCount,
    );

    if (activeIncludedAudit) {
      return [];
    }

    if (daysInSystem >= THURSDAY_SWEEP_AGE_DAYS) {
      reasons.push("age");
    }

    if (
      depletionPercent !== null &&
      depletionPercent > THURSDAY_SWEEP_DEPLETION_PERCENT
    ) {
      reasons.push("depletion");
    }

    if (reasons.length === 0) {
      return [];
    }

    return {
      binNumber: inventory.bin_number,
      dateActivated: inventory.date_activated,
      dateReceived,
      daysInSystem,
      depletionPercent,
      gameId: inventory.game_id,
      gameName: game?.game_name ?? "Unknown game",
      inventoryId: inventory.id,
      latestAuditAt: latestAudit?.created_at ?? null,
      latestTicketNumber,
      packId:
        inventory.pack_id ?? `${inventory.game_id}-${inventory.pack_number}`,
      packNumber: inventory.pack_number,
      packValue,
      reasons,
      ticketCount,
      ticketPrice,
    } satisfies LotteryEftThursdaySweepPack;
  });

  const sortedPacks = packs.sort(
    (left, right) =>
      Number(right.reasons.includes("depletion")) -
        Number(left.reasons.includes("depletion")) ||
      (right.depletionPercent ?? 0) - (left.depletionPercent ?? 0) ||
      right.daysInSystem - left.daysInSystem ||
      (left.binNumber ?? 9999) - (right.binNumber ?? 9999),
  );

  return {
    agedPackCount: sortedPacks.filter((pack) => pack.reasons.includes("age"))
      .length,
    depletedPackCount: sortedPacks.filter((pack) =>
      pack.reasons.includes("depletion"),
    ).length,
    packs: sortedPacks,
    paymentStatus,
    sweepDate,
    totalPackValue: normalizeMoney(
      sortedPacks.reduce((total, pack) => total + (pack.packValue ?? 0), 0),
    ),
    weekEndDate: endDate,
    weekStartDate: startDate,
  };
}

function addTransaction(
  transactions: LotteryEftTransactionRow[],
  row: LotteryEftTransactionRow,
) {
  if (row.amount <= 0 && row.effect !== "net") {
    return;
  }

  transactions.push(row);
}

async function loadScratchPackSettlementSales({
  auditRows,
  endDate,
  startDate,
  storeKey,
  supabase,
}: {
  auditRows: ScratchSettlementAuditRow[];
  endDate: string;
  startDate: string;
  storeKey: string;
  supabase: SupabaseServerClient;
}) {
  const inventoryIds = Array.from(
    new Set(
      auditRows
        .map((row) => row.inventory_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (inventoryIds.length === 0) {
    return {
      data: [] as ScratchPackSettlementSale[],
      error: null as { message?: string | null } | null,
    };
  }

  const inventoryResult = await supabase
    .from("inventory")
    .select("id,game_id,pack_ticket_count")
    .eq("store_key", storeKey)
    .in("id", inventoryIds)
    .returns<ScratchSettlementInventoryRow[]>();

  if (inventoryResult.error) {
    return { data: [], error: inventoryResult.error };
  }

  const gameIds = Array.from(
    new Set((inventoryResult.data ?? []).map((row) => row.game_id)),
  );

  if (gameIds.length === 0) {
    return {
      data: [] as ScratchPackSettlementSale[],
      error: null as { message?: string | null } | null,
    };
  }

  const gameResult = await supabase
    .from("game_catalog")
    .select("game_id,ticket_count,ticket_price")
    .in("game_id", gameIds)
    .returns<ScratchSettlementGameRow[]>();

  if (gameResult.error) {
    return { data: [], error: gameResult.error };
  }

  return {
    data: buildScratchPackSettlementSales({
      auditRows,
      endDate,
      gameRows: gameResult.data ?? [],
      inventoryRows: inventoryResult.data ?? [],
      startDate,
    }),
    error: null,
  };
}

async function loadScratchSettlementAuditRows({
  endDate,
  storeKey,
  supabase,
}: {
  endDate: string;
  storeKey: string;
  supabase: SupabaseServerClient;
}) {
  const auditRows: ScratchSettlementAuditRow[] = [];

  for (let offset = 0; ; offset += SETTLEMENT_AUDIT_PAGE_SIZE) {
    const result = await supabase
      .from("daily_audits")
      .select(
        "audit_id,inventory_id,audit_date,audit_type,bin_number,end_ticket_no,created_at",
      )
      .eq("store_key", storeKey)
      .in("audit_type", [
        SCRATCH_EFT_SETTLEMENT_AUDIT_TYPE,
        SCRATCH_EFT_ACTIVE_29_DAY_SETTLEMENT_AUDIT_TYPE,
        SCRATCH_EFT_SETTLEMENT_REVERSAL_AUDIT_TYPE,
      ])
      .lte("audit_date", endDate)
      .order("audit_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + SETTLEMENT_AUDIT_PAGE_SIZE - 1)
      .returns<ScratchSettlementAuditRow[]>();

    if (result.error) {
      return {
        data: [] as ScratchSettlementAuditRow[],
        error: result.error,
      };
    }

    const page = result.data ?? [];
    auditRows.push(...page);

    if (page.length < SETTLEMENT_AUDIT_PAGE_SIZE) {
      break;
    }
  }

  return {
    data: auditRows,
    error: null as { message?: string | null } | null,
  };
}

async function loadInventoryAuditRows({
  endDate,
  inventoryIds,
  storeKey,
  supabase,
}: {
  endDate?: string;
  inventoryIds: string[];
  storeKey: string;
  supabase: SupabaseServerClient;
}) {
  if (inventoryIds.length === 0) {
    return {
      data: [] as InventoryAuditRow[],
      error: null as { message?: string | null } | null,
    };
  }

  const auditRows: InventoryAuditRow[] = [];

  for (let offset = 0; ; offset += SETTLEMENT_AUDIT_PAGE_SIZE) {
    let query = supabase
      .from("daily_audits")
      .select(
        "audit_id,inventory_id,audit_date,audit_type,bin_number,end_ticket_no,created_at",
      )
      .eq("store_key", storeKey)
      .in("inventory_id", inventoryIds)
      .order("audit_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + SETTLEMENT_AUDIT_PAGE_SIZE - 1);

    if (endDate) {
      query = query.lte("audit_date", endDate);
    }

    const result = await query.returns<InventoryAuditRow[]>();

    if (result.error) {
      return {
        data: [] as InventoryAuditRow[],
        error: result.error,
      };
    }

    const page = result.data ?? [];
    auditRows.push(...page);

    if (page.length < SETTLEMENT_AUDIT_PAGE_SIZE) {
      break;
    }
  }

  return {
    data: auditRows,
    error: null as { message?: string | null } | null,
  };
}

function buildSoldOutPackLedger({
  auditRows,
  gameRows,
  inventoryRows,
  selectedWeekEndDate,
  selectedWeekStartDate,
  timeZone,
}: {
  auditRows: ScratchSettlementAuditRow[];
  gameRows: SoldOutPackGameRow[];
  inventoryRows: SoldOutPackInventoryRow[];
  selectedWeekEndDate: string;
  selectedWeekStartDate: string;
  timeZone: string;
}) {
  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const sortedAudits = [...auditRows].sort(
    (left, right) =>
      left.audit_date.localeCompare(right.audit_date) ||
      left.created_at.localeCompare(right.created_at),
  );
  const auditsByInventory = sortedAudits.reduce((byInventory, audit) => {
    if (!audit.inventory_id) {
      return byInventory;
    }

    byInventory.set(audit.inventory_id, [
      ...(byInventory.get(audit.inventory_id) ?? []),
      audit,
    ]);

    return byInventory;
  }, new Map<string, ScratchSettlementAuditRow[]>());

  return inventoryRows
    .flatMap((inventory) => {
      const game = gameById.get(inventory.game_id);
      const ticketCount = normalizeTicketCount(
        inventory.pack_ticket_count ?? game?.ticket_count,
      );
      const ticketPrice = normalizeMoney(game?.ticket_price);
      const packValue = ticketCount
        ? normalizeMoney(ticketCount * ticketPrice)
        : null;
      const inventoryAudits = auditsByInventory.get(inventory.id) ?? [];
      const { activeIncludedAudit, latestReversalAudit, soldOutAudit } =
        getScratchEftSettlementState(inventoryAudits, ticketCount);
      const activatedDate = getDateKeyForStore(
        inventory.date_activated,
        timeZone,
      );
      const activeDueDate = getActivePackSettlementDueDate({
        dateActivated: inventory.date_activated,
        timeZone,
      });
      const includedDate = activeIncludedAudit?.audit_date ?? null;
      const includedInSelectedEft = includedDate
        ? isDateInRange(
            includedDate,
            selectedWeekStartDate,
            selectedWeekEndDate,
          )
        : false;
      const isActiveDue = Boolean(
        activeDueDate && activeDueDate <= selectedWeekEndDate,
      );
      const shouldShow =
        Boolean(activeIncludedAudit) ||
        Boolean(soldOutAudit) ||
        inventory.status === "settled" ||
        inventory.status === "sold_out" ||
        isActiveDue;

      if (!shouldShow) {
        return [];
      }

      const pendingReason: LotteryEftSettlementPackReason = soldOutAudit
        ? "sold_out"
        : "active_29_day";
      const dueDate =
        soldOutAudit?.audit_date ??
        activeDueDate ??
        activeIncludedAudit?.audit_date ??
        inventory.updated_at.slice(0, 10);
      const status: LotteryEftSoldOutPackStatus = activeIncludedAudit
        ? includedInSelectedEft
          ? "included-selected"
          : "included-other"
        : "pending";

      return [
        {
          activatedDate,
          binNumber: soldOutAudit?.bin_number ?? inventory.bin_number ?? null,
          dueDate,
          gameId: inventory.game_id,
          gameName: game?.game_name ?? "Unknown game",
          hasSoldOutAudit: Boolean(soldOutAudit),
          includedAuditId: activeIncludedAudit?.audit_id ?? null,
          includedDate,
          includedInSelectedEft,
          inventoryId: inventory.id,
          inventoryStatus: inventory.status,
          packNumber: inventory.pack_number,
          packValue,
          pendingReason,
          reversalAuditId: latestReversalAudit?.audit_id ?? null,
          reversedDate: latestReversalAudit?.audit_date ?? null,
          soldOutAuditType: soldOutAudit?.audit_type ?? null,
          soldOutDate: soldOutAudit?.audit_date ?? null,
          status,
          ticketCount,
          ticketPrice,
        } satisfies LotteryEftSoldOutPackRow,
      ];
    })
    .sort(
      (left, right) =>
        Number(left.status !== "pending") -
          Number(right.status !== "pending") ||
        right.dueDate.localeCompare(left.dueDate) ||
        left.gameId.localeCompare(right.gameId) ||
        left.packNumber.localeCompare(right.packNumber),
    );
}

async function loadSoldOutPackLedger({
  selectedWeekEndDate,
  selectedWeekStartDate,
  storeKey,
  supabase,
  timeZone,
}: {
  selectedWeekEndDate: string;
  selectedWeekStartDate: string;
  storeKey: string;
  supabase: SupabaseServerClient;
  timeZone: string;
}) {
  const inventoryResult = await supabase
    .from("inventory")
    .select(
      "id,game_id,pack_number,pack_ticket_count,bin_number,date_activated,status,updated_at",
    )
    .eq("store_key", storeKey)
    .in("status", ["active", "sold_out", "settled"])
    .returns<SoldOutPackInventoryRow[]>();

  if (inventoryResult.error) {
    return { data: [], error: inventoryResult.error };
  }

  const inventoryRows = inventoryResult.data ?? [];
  const inventoryIds = inventoryRows.map((row) => row.id);

  if (inventoryIds.length === 0) {
    return {
      data: [] as LotteryEftSoldOutPackRow[],
      error: null as { message?: string | null } | null,
    };
  }

  const gameIds = Array.from(new Set(inventoryRows.map((row) => row.game_id)));

  if (gameIds.length === 0) {
    return {
      data: [] as LotteryEftSoldOutPackRow[],
      error: null as { message?: string | null } | null,
    };
  }

  const gameResult = await supabase
    .from("game_catalog")
    .select("game_id,game_name,ticket_count,ticket_price")
    .in("game_id", gameIds)
    .returns<SoldOutPackGameRow[]>();

  if (gameResult.error) {
    return { data: [], error: gameResult.error };
  }

  const auditResult = await loadInventoryAuditRows({
    inventoryIds,
    storeKey,
    supabase,
  });

  if (auditResult.error) {
    return { data: [], error: auditResult.error };
  }

  return {
    data: buildSoldOutPackLedger({
      auditRows: auditResult.data ?? [],
      gameRows: gameResult.data ?? [],
      inventoryRows,
      selectedWeekEndDate,
      selectedWeekStartDate,
      timeZone,
    }),
    error: null,
  };
}

function buildRows({
  auditRows,
  cashingBonusRate,
  dateKeys,
  retailerCommissionRate,
  settlementRows,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  cashingBonusRate: number;
  dateKeys: string[];
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  terminalRows: TerminalReportRow[];
}) {
  const auditsByDate = new Map<string, DailyAuditRow[]>();
  const settlementsByDate = sumScratchPackSettlementsByDate(settlementRows);
  const terminalsByDate = new Map<string, TerminalReportRow>();
  const transactions: LotteryEftTransactionRow[] = [];

  auditRows.forEach((row) => {
    auditsByDate.set(row.audit_date, [
      ...(auditsByDate.get(row.audit_date) ?? []),
      row,
    ]);
  });
  terminalRows.forEach((row) => terminalsByDate.set(row.report_date, row));

  const dailyRows = dateKeys
    .map((reportDate) => {
      const terminal = terminalsByDate.get(reportDate);
      const scratchSales = calculateLotteryEodScratchSales(
        auditsByDate.get(reportDate) ?? [],
      );
      const drawSales = normalizeMoney(terminal?.draw_sales);
      const drawPayouts = normalizeMoney(terminal?.draw_payouts);
      const scratchPayouts = normalizeMoney(terminal?.scratch_payouts);
      const dailyBondingFee = normalizeMoney(terminal?.lottery_bonding_fee);
      const promoCredits = normalizeMoney(terminal?.total_cashing_bonus);
      const ticketCancels = normalizeMoney(terminal?.total_cancels);
      const scratchReturns = normalizeMoney(terminal?.scratch_returns);
      const settledPackSales = normalizeMoney(
        settlementsByDate.get(reportDate),
      );
      const grossSales = normalizeMoney(drawSales + settledPackSales);
      const eftFormula = calculateLotteryEftFormula({
        administrativeFees: 0,
        bondingFee: dailyBondingFee,
        grossSales,
        payoutCommissionRate: cashingBonusRate,
        promoCredits,
        prizePayouts: drawPayouts + scratchPayouts,
        retailerCommissionRate,
        ticketCancels,
      });
      const {
        administrativeFees,
        bondingFee,
        netEftDue,
        netTicketSales,
        payoutCommissionCredit: cashingBonusCredit,
        retailerCommissionCredit,
        totalCommissions,
        totalCredits,
        totalPayouts,
      } = eftFormula;
      const expectedCash = netTicketSales;
      const hasActivity = Boolean(terminal) || settledPackSales > 0;
      const status = !hasActivity
        ? "pending"
        : netEftDue > 0
          ? "due"
          : netEftDue < 0
            ? "credit"
            : "zero";

      addTransaction(transactions, {
        amount: drawSales,
        category: "sale",
        effect: "add",
        label: "Online ticket sales (S)",
        reportDate,
      });
      addTransaction(transactions, {
        amount: settledPackSales,
        category: "sale",
        effect: "add",
        label: "Settled scratch pack sales",
        reportDate,
      });
      addTransaction(transactions, {
        amount: ticketCancels,
        category: "cancel",
        effect: "subtract",
        label: "Cancelled tickets (C)",
        reportDate,
      });
      addTransaction(transactions, {
        amount: totalPayouts,
        category: "payout",
        effect: "subtract",
        label: "Prize payouts (P)",
        reportDate,
      });
      addTransaction(transactions, {
        amount: promoCredits,
        category: "promo",
        effect: "subtract",
        label: "PROMO",
        reportDate,
      });
      addTransaction(transactions, {
        amount: retailerCommissionCredit,
        category: "commission",
        effect: "subtract",
        label: `Retailer commission ${retailerCommissionRate}%`,
        reportDate,
      });
      addTransaction(transactions, {
        amount: cashingBonusCredit,
        category: "commission",
        effect: "subtract",
        label: `Payout commission ${cashingBonusRate}%`,
        reportDate,
      });
      addTransaction(transactions, {
        amount: bondingFee,
        category: "fee",
        effect: "add",
        label: "Bonding fee (B)",
        reportDate,
      });
      addTransaction(transactions, {
        amount: administrativeFees,
        category: "fee",
        effect: "add",
        label: "Administrative and tech fees",
        reportDate,
      });
      addTransaction(transactions, {
        amount: netEftDue,
        category: "due",
        effect: "net",
        label: "Net EFT due",
        reportDate,
      });

      return {
        administrativeFees,
        bondingFee,
        cashingBonusCredit,
        drawPayouts,
        drawSales,
        expectedCash,
        grossSales,
        netEftDue,
        netTicketSales,
        promoCredits,
        reportDate,
        retailerCommissionCredit,
        scratchPayouts,
        scratchReturns,
        scratchSales,
        settledPackSales,
        ticketCancels,
        totalCommissions,
        totalCredits,
        totalPayouts,
        status,
      } satisfies LotteryEftDailyRow;
    })
    .reverse();

  return {
    dailyRows,
    transactions: transactions.reverse(),
  };
}

function buildSummary(dailyRows: LotteryEftDailyRow[]) {
  return {
    administrativeFees: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.administrativeFees, 0),
    ),
    bondingFee: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.bondingFee, 0),
    ),
    cashingBonusCredit: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.cashingBonusCredit, 0),
    ),
    grossSales: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.grossSales, 0),
    ),
    netEftDue: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.netEftDue, 0),
    ),
    netTicketSales: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.netTicketSales, 0),
    ),
    promoCredits: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.promoCredits, 0),
    ),
    openDays: dailyRows.filter((row) => row.status === "due").length,
    retailerCommissionCredit: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.retailerCommissionCredit, 0),
    ),
    settledPackSales: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.settledPackSales, 0),
    ),
    totalCommissions: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.totalCommissions, 0),
    ),
    totalCredits: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.totalCredits, 0),
    ),
    totalPayouts: normalizeMoney(
      dailyRows.reduce((total, row) => total + row.totalPayouts, 0),
    ),
  } satisfies LotteryEftSummary;
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

function isMissingEftEvidenceColumnError(error: {
  code?: string | null;
  message?: string | null;
}) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    (message.includes("paid_reference") || message.includes("paid_notes")) &&
    (error.code === "42703" ||
      error.code === "PGRST204" ||
      message.includes("schema cache"))
  );
}

async function loadEftWeeklyStatusRows({
  storeKey,
  supabase,
  sweepDates,
}: {
  storeKey: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  sweepDates: string[];
}) {
  if (sweepDates.length === 0) {
    return {
      available: true,
      rows: [] as EftWeeklyStatusRow[],
    };
  }

  const { data, error } = await supabase
    .from("lottery_eft_weekly_status")
    .select(
      "week_start_date,week_end_date,sweep_date,status,paid_at,paid_amount,paid_reference,paid_notes,marked_by",
    )
    .eq("store_key", storeKey)
    .in("sweep_date", sweepDates)
    .returns<EftWeeklyStatusRow[]>();

  if (error) {
    if (isMissingEftWeeklyStatusTableError(error)) {
      return {
        available: false,
        rows: [] as EftWeeklyStatusRow[],
      };
    }

    if (isMissingEftEvidenceColumnError(error)) {
      const legacyResult = await supabase
        .from("lottery_eft_weekly_status")
        .select(
          "week_start_date,week_end_date,sweep_date,status,paid_at,paid_amount,marked_by",
        )
        .eq("store_key", storeKey)
        .in("sweep_date", sweepDates)
        .returns<Omit<EftWeeklyStatusRow, "paid_notes" | "paid_reference">[]>();

      if (legacyResult.error) {
        if (isMissingEftPaidAmountColumnError(legacyResult.error)) {
          const legacyWithoutPaidAmountResult = await supabase
            .from("lottery_eft_weekly_status")
            .select(
              "week_start_date,week_end_date,sweep_date,status,paid_at,marked_by",
            )
            .eq("store_key", storeKey)
            .in("sweep_date", sweepDates)
            .returns<Omit<EftWeeklyStatusRow, "paid_amount">[]>();

          if (legacyWithoutPaidAmountResult.error) {
            throw legacyWithoutPaidAmountResult.error;
          }

          return {
            available: false,
            rows: (legacyWithoutPaidAmountResult.data ?? []).map((row) => ({
              ...row,
              paid_amount: null,
              paid_notes: null,
              paid_reference: null,
            })),
          };
        }

        throw legacyResult.error;
      }

      return {
        available: false,
        rows: (legacyResult.data ?? []).map((row) => ({
          ...row,
          paid_notes: null,
          paid_reference: null,
        })),
      };
    }

    if (isMissingEftPaidAmountColumnError(error)) {
      const legacyResult = await supabase
        .from("lottery_eft_weekly_status")
        .select(
          "week_start_date,week_end_date,sweep_date,status,paid_at,marked_by",
        )
        .eq("store_key", storeKey)
        .in("sweep_date", sweepDates)
        .returns<Omit<EftWeeklyStatusRow, "paid_amount">[]>();

      if (legacyResult.error) {
        throw legacyResult.error;
      }

      return {
        available: false,
        rows: (legacyResult.data ?? []).map((row) => ({
          ...row,
          paid_amount: null,
          paid_notes: null,
          paid_reference: null,
        })),
      };
    }

    throw error;
  }

  const rows = data ?? [];
  const markerIds = Array.from(
    new Set(rows.map((row) => row.marked_by).filter(Boolean) as string[]),
  );

  if (markerIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .in("id", markerIds)
      .returns<ProfileNameRow[]>();

    if (!profileError) {
      const profileById = new Map(
        (profiles ?? []).map((profile) => [
          profile.id,
          profile.full_name ?? profile.email ?? null,
        ]),
      );

      rows.forEach((row) => {
        row.markedByName = row.marked_by
          ? (profileById.get(row.marked_by) ?? null)
          : null;
      });
    }
  }

  return {
    available: true,
    rows,
  };
}

function getLedgerPeriods({
  latestSweepDate,
  selectedSweepDate,
  weeks,
}: {
  latestSweepDate: string;
  selectedSweepDate: string;
  weeks: number;
}) {
  const periods = getLotteryEftSweepPeriods({
    latestSweepDate,
    weeks,
  });

  if (!periods.some((period) => period.sweepDate === selectedSweepDate)) {
    periods.push(getLotteryEftSweepPeriod(selectedSweepDate));
  }

  return periods.sort((left, right) =>
    right.sweepDate.localeCompare(left.sweepDate),
  );
}

function getLedgerQueryRange(
  periods: Array<ReturnType<typeof getLotteryEftSweepPeriod>>,
) {
  const startDate = periods.reduce(
    (current, period) =>
      period.weekStartDate < current ? period.weekStartDate : current,
    periods[0]?.weekStartDate ?? "",
  );
  const endDate = periods.reduce(
    (current, period) =>
      period.weekEndDate > current ? period.weekEndDate : current,
    periods[0]?.weekEndDate ?? "",
  );

  return { endDate, startDate };
}

function buildWeeklyLedger({
  auditRows,
  cashingBonusRate,
  periods,
  retailerCommissionRate,
  settlementRows,
  statusRows,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  cashingBonusRate: number;
  periods: Array<ReturnType<typeof getLotteryEftSweepPeriod>>;
  retailerCommissionRate: number;
  settlementRows: ScratchPackSettlementSale[];
  statusRows: EftWeeklyStatusRow[];
  terminalRows: TerminalReportRow[];
}) {
  const statusBySweepDate = new Map(
    statusRows.map((row) => [row.sweep_date, row]),
  );

  return periods.map((period) => {
    const { dailyRows } = buildRows({
      auditRows,
      cashingBonusRate,
      dateKeys: enumerateIsoDateRange(period.weekStartDate, period.weekEndDate),
      retailerCommissionRate,
      settlementRows,
      terminalRows,
    });
    const summary = buildSummary(dailyRows);
    const statusRow = statusBySweepDate.get(period.sweepDate);
    const paidAmount = normalizeOptionalLotteryEftPaidAmount(
      statusRow?.paid_amount,
    );

    return {
      ...summary,
      appliedPaidAmount: calculateAppliedLotteryEftPayment({
        netEftDue: summary.netEftDue,
        paidAmount,
      }),
      markedBy: statusRow?.markedByName ?? null,
      paidAt: statusRow?.paid_at ?? null,
      paidAmount,
      paidNotes: statusRow?.paid_notes?.trim() || null,
      paidReference: statusRow?.paid_reference?.trim() || null,
      paymentStatus: statusRow?.status ?? "unpaid",
      sweepDate: period.sweepDate,
      weekEndDate: period.weekEndDate,
      weekStartDate: period.weekStartDate,
    } satisfies LotteryEftWeeklyLedgerRow;
  });
}

function buildWeeklySummary(weeklyLedger: LotteryEftWeeklyLedgerRow[]) {
  return weeklyLedger.reduce<LotteryEftWeeklySummary>((summary, week) => {
    summary.totalExpectedCash = normalizeMoney(
      summary.totalExpectedCash + week.netTicketSales,
    );
    summary.totalNetEftDue = normalizeMoney(
      summary.totalNetEftDue + week.netEftDue,
    );

    if (week.paymentStatus === "paid") {
      summary.paidWeeks += 1;
      summary.paidNetEftDue = normalizeMoney(
        summary.paidNetEftDue + week.appliedPaidAmount,
      );
    } else {
      summary.unpaidWeeks += 1;
      summary.unpaidNetEftDue = normalizeMoney(
        summary.unpaidNetEftDue + week.netEftDue,
      );
    }

    return summary;
  }, buildEmptyWeeklySummary());
}

export async function loadLotteryEftData(
  options: LoadLotteryEftOptions = {},
): Promise<LotteryEftData> {
  noStore();
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const weeks = normalizeWeeks(options.weeks);
  const businessDate = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const latestSweepDate = getLatestLotteryEftSweepDate(businessDate);
  const runningSweepDate =
    getLotteryEftSweepDateForReportDate(businessDate) ?? latestSweepDate;
  const runningPeriod = getLotteryEftSweepPeriod(runningSweepDate);
  const selectedSweepDate = resolveLotteryEftSelectedSweepDate({
    fallback: runningSweepDate,
    maxSweepDate: runningSweepDate,
    value: options.sweepDate,
  });
  const ledgerEndSweepDate = options.ledgerEndSweepDate
    ? resolveLotteryEftSelectedSweepDate({
        fallback: runningSweepDate,
        maxSweepDate: runningSweepDate,
        value: options.ledgerEndSweepDate,
      })
    : latestSweepDate;
  const selectedPeriod = getLotteryEftSweepPeriod(selectedSweepDate);
  const ledgerPeriods = getLedgerPeriods({
    latestSweepDate: ledgerEndSweepDate,
    selectedSweepDate,
    weeks,
  });
  if (
    !options.ledgerEndSweepDate &&
    !ledgerPeriods.some((period) => period.sweepDate === runningSweepDate)
  ) {
    ledgerPeriods.push(runningPeriod);
    ledgerPeriods.sort((left, right) =>
      right.sweepDate.localeCompare(left.sweepDate),
    );
  }
  const { endDate: queryEndDate, startDate: queryStartDate } =
    getLedgerQueryRange(ledgerPeriods);
  const dateKeys = enumerateIsoDateRange(
    selectedPeriod.weekStartDate,
    selectedPeriod.weekEndDate,
  );
  const emptyWeeklySummary = buildEmptyWeeklySummary();

  if (!isSupabaseConfigured()) {
    return {
      cashingBonusRate: 0,
      dailyRows: [],
      endDate: selectedPeriod.weekEndDate,
      latestSweepDate,
      retailerCommissionRate: 0,
      selectedSweepDate,
      source: "unconfigured",
      startDate: selectedPeriod.weekStartDate,
      statusLedgerAvailable: false,
      storeKey: activeStoreKey,
      summary: buildEmptySummary(),
      soldOutPacks: [],
      thursdaySweep: buildEmptyThursdaySweep(),
      transactions: [],
      weekEndDate: selectedPeriod.weekEndDate,
      weekStartDate: selectedPeriod.weekStartDate,
      weeklyLedger: [],
      weeklySummary: emptyWeeklySummary,
      weeks,
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
  const [auditResult, terminalResult, inventoryResult, settlementAuditResult] =
    await Promise.all([
      supabase
        .from("daily_audits")
        .select("audit_date,audit_type,calculated_revenue")
        .eq("store_key", activeStoreKey)
        .eq("audit_type", "eod")
        .gte("audit_date", queryStartDate)
        .lte("audit_date", queryEndDate)
        .returns<DailyAuditRow[]>(),
      supabase
        .from("terminal_reports")
        .select(
          "report_date,draw_sales,draw_payouts,scratch_payouts,scratch_returns,total_cashing_bonus,total_cancels,lottery_bonding_fee",
        )
        .eq("store_key", activeStoreKey)
        .gte("report_date", queryStartDate)
        .lte("report_date", queryEndDate)
        .returns<TerminalReportRow[]>(),
      supabase
        .from("inventory")
        .select(
          "id,bin_number,created_at,date_activated,date_received,game_id,pack_id,pack_number,pack_ticket_count",
        )
        .eq("store_key", activeStoreKey)
        .eq("status", "active")
        .returns<ActiveInventoryRow[]>(),
      loadScratchSettlementAuditRows({
        endDate: queryEndDate,
        storeKey: activeStoreKey,
        supabase,
      }),
    ]);
  const firstError =
    auditResult.error ??
    terminalResult.error ??
    inventoryResult.error ??
    settlementAuditResult.error;

  if (firstError) {
    return {
      cashingBonusRate,
      dailyRows: [],
      endDate: selectedPeriod.weekEndDate,
      errorMessage:
        firstError.message ?? "Lottery EFT data could not be loaded.",
      latestSweepDate,
      retailerCommissionRate,
      selectedSweepDate,
      source: "error",
      startDate: selectedPeriod.weekStartDate,
      statusLedgerAvailable: false,
      storeKey: activeStoreKey,
      summary: buildEmptySummary(),
      soldOutPacks: [],
      thursdaySweep: buildEmptyThursdaySweep(),
      transactions: [],
      weekEndDate: selectedPeriod.weekEndDate,
      weekStartDate: selectedPeriod.weekStartDate,
      weeklyLedger: [],
      weeklySummary: emptyWeeklySummary,
      weeks,
    };
  }

  const settlementResult = await loadScratchPackSettlementSales({
    auditRows: settlementAuditResult.data ?? [],
    endDate: queryEndDate,
    startDate: queryStartDate,
    storeKey: activeStoreKey,
    supabase,
  });

  if (settlementResult.error) {
    return {
      cashingBonusRate,
      dailyRows: [],
      endDate: selectedPeriod.weekEndDate,
      errorMessage:
        settlementResult.error.message ??
        "Settled scratch pack data could not be loaded.",
      latestSweepDate,
      retailerCommissionRate,
      selectedSweepDate,
      source: "error",
      startDate: selectedPeriod.weekStartDate,
      statusLedgerAvailable: false,
      storeKey: activeStoreKey,
      summary: buildEmptySummary(),
      soldOutPacks: [],
      thursdaySweep: buildEmptyThursdaySweep(),
      transactions: [],
      weekEndDate: selectedPeriod.weekEndDate,
      weekStartDate: selectedPeriod.weekStartDate,
      weeklyLedger: [],
      weeklySummary: emptyWeeklySummary,
      weeks,
    };
  }

  const settlementRows = settlementResult.data;
  const statusResult = await loadEftWeeklyStatusRows({
    storeKey: activeStoreKey,
    supabase,
    sweepDates: ledgerPeriods.map((period) => period.sweepDate),
  });
  const runningWeekPaymentStatus =
    statusResult.rows.find((row) => row.sweep_date === runningSweepDate)
      ?.status ?? "unpaid";
  const soldOutPackLedgerResult = await loadSoldOutPackLedger({
    selectedWeekEndDate: runningPeriod.weekEndDate,
    selectedWeekStartDate: runningPeriod.weekStartDate,
    storeKey: activeStoreKey,
    supabase,
    timeZone: activeStore.timeZone,
  });

  if (soldOutPackLedgerResult.error) {
    return {
      cashingBonusRate,
      dailyRows: [],
      endDate: selectedPeriod.weekEndDate,
      errorMessage:
        soldOutPackLedgerResult.error.message ??
        "Scratch pack settlement ledger could not be loaded.",
      latestSweepDate,
      retailerCommissionRate,
      selectedSweepDate,
      source: "error",
      startDate: selectedPeriod.weekStartDate,
      statusLedgerAvailable: statusResult.available,
      storeKey: activeStoreKey,
      summary: buildEmptySummary(),
      soldOutPacks: [],
      thursdaySweep: buildEmptyThursdaySweep(),
      transactions: [],
      weekEndDate: selectedPeriod.weekEndDate,
      weekStartDate: selectedPeriod.weekStartDate,
      weeklyLedger: [],
      weeklySummary: emptyWeeklySummary,
      weeks,
    };
  }

  const soldOutPacks = soldOutPackLedgerResult.data;
  const activeInventoryRows = inventoryResult.data ?? [];
  let thursdaySweep = buildEmptyThursdaySweep();

  if (activeInventoryRows.length > 0) {
    const gameIds = Array.from(
      new Set(activeInventoryRows.map((row) => row.game_id)),
    );
    const inventoryIds = activeInventoryRows.map((row) => row.id);
    const [gameResult, inventoryAuditResult] = await Promise.all([
      supabase
        .from("game_catalog")
        .select("game_id,game_name,ticket_price,ticket_count")
        .in("game_id", gameIds)
        .returns<GameCatalogRow[]>(),
      loadInventoryAuditRows({
        inventoryIds,
        storeKey: activeStoreKey,
        supabase,
      }),
    ]);
    const sweepError = gameResult.error ?? inventoryAuditResult.error;

    if (sweepError) {
      return {
        cashingBonusRate,
        dailyRows: [],
        endDate: selectedPeriod.weekEndDate,
        errorMessage:
          sweepError.message ?? "Thursday Sweep data could not be loaded.",
        latestSweepDate,
        retailerCommissionRate,
        selectedSweepDate,
        source: "error",
        startDate: selectedPeriod.weekStartDate,
        statusLedgerAvailable: statusResult.available,
        storeKey: activeStoreKey,
        summary: buildEmptySummary(),
        soldOutPacks: [],
        thursdaySweep: buildEmptyThursdaySweep(),
        transactions: [],
        weekEndDate: selectedPeriod.weekEndDate,
        weekStartDate: selectedPeriod.weekStartDate,
        weeklyLedger: [],
        weeklySummary: emptyWeeklySummary,
        weeks,
      };
    }

    thursdaySweep = buildThursdaySweep({
      auditRows: inventoryAuditResult.data ?? [],
      endDate: runningPeriod.weekEndDate,
      gameRows: gameResult.data ?? [],
      inventoryRows: activeInventoryRows,
      paymentStatus: runningWeekPaymentStatus,
      startDate: runningPeriod.weekStartDate,
      sweepDate: runningPeriod.sweepDate,
    });
  }

  const { dailyRows, transactions } = buildRows({
    auditRows: auditResult.data ?? [],
    cashingBonusRate,
    dateKeys,
    retailerCommissionRate,
    settlementRows,
    terminalRows: terminalResult.data ?? [],
  });
  const weeklyLedger = buildWeeklyLedger({
    auditRows: auditResult.data ?? [],
    cashingBonusRate,
    periods: ledgerPeriods,
    retailerCommissionRate,
    settlementRows,
    statusRows: statusResult.rows,
    terminalRows: terminalResult.data ?? [],
  });

  return {
    cashingBonusRate,
    dailyRows,
    endDate: selectedPeriod.weekEndDate,
    latestSweepDate,
    retailerCommissionRate,
    selectedSweepDate,
    source: "database",
    startDate: selectedPeriod.weekStartDate,
    statusLedgerAvailable: statusResult.available,
    storeKey: activeStoreKey,
    summary: buildSummary(dailyRows),
    soldOutPacks,
    thursdaySweep,
    transactions,
    weekEndDate: selectedPeriod.weekEndDate,
    weekStartDate: selectedPeriod.weekStartDate,
    weeklyLedger,
    weeklySummary: buildWeeklySummary(weeklyLedger),
    weeks,
  };
}

function normalizeRequiredText(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new LotteryEftWorkflowError(`${label} is required`, 400);
  }

  return normalized;
}

export async function includeScratchPackInLotteryEft(
  access: ScratchCardAccess,
  input: {
    inventoryId: unknown;
    sweepDate: unknown;
  },
) {
  const inventoryId = normalizeRequiredText(input.inventoryId, "Inventory id");
  const sweepDate =
    typeof input.sweepDate === "string" ? input.sweepDate.trim() : "";

  if (!isLotteryEftSweepDate(sweepDate)) {
    throw new LotteryEftWorkflowError(
      "EFT sweep date must be a Thursday date",
      400,
    );
  }

  const businessDate = getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
  const latestSweepDate = getLatestLotteryEftSweepDate(businessDate);
  const latestSettleableSweepDate =
    getLotteryEftSweepDateForReportDate(businessDate) ?? latestSweepDate;

  if (sweepDate > latestSettleableSweepDate) {
    throw new LotteryEftWorkflowError(
      `EFT sweep ${sweepDate} is not available yet. Latest available sweep is ${latestSettleableSweepDate}.`,
      409,
    );
  }

  const period = getLotteryEftSweepPeriod(sweepDate);
  const statusResult = await access.supabase
    .from("lottery_eft_weekly_status")
    .select("status")
    .eq("store_key", access.activeStoreKey)
    .eq("sweep_date", period.sweepDate)
    .maybeSingle<{ status: LotteryEftPaymentStatus }>();

  if (
    statusResult.error &&
    !isMissingEftWeeklyStatusTableError(statusResult.error)
  ) {
    throw new LotteryEftWorkflowError(
      statusResult.error.message ?? "Failed to check EFT payment status",
      500,
    );
  }

  if (statusResult.data?.status === "paid") {
    throw new LotteryEftWorkflowError(
      "Mark this EFT week unpaid before settling scratch packs.",
      409,
    );
  }

  const { data: inventory, error: inventoryError } = await access.supabase
    .from("inventory")
    .select(
      "id,game_id,pack_number,pack_ticket_count,bin_number,date_activated,status,updated_at",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("id", inventoryId)
    .maybeSingle<SoldOutPackInventoryRow>();

  if (inventoryError) {
    throw new LotteryEftWorkflowError(
      inventoryError.message ?? "Failed to load scratch pack",
      500,
    );
  }

  if (!inventory) {
    throw new LotteryEftWorkflowError("Scratch pack was not found", 404);
  }

  if (inventory.status === "settled") {
    throw new LotteryEftWorkflowError(
      "This scratch pack is already settled.",
      409,
    );
  }

  if (inventory.status !== "sold_out" && inventory.status !== "active") {
    throw new LotteryEftWorkflowError(
      "Only sold-out or 29-day active scratch packs can be settled to EFT.",
      409,
    );
  }

  const { data: game, error: gameError } = await access.supabase
    .from("game_catalog")
    .select("game_id,game_name,ticket_count,ticket_price")
    .eq("game_id", inventory.game_id)
    .maybeSingle<SoldOutPackGameRow>();

  if (gameError) {
    throw new LotteryEftWorkflowError(
      gameError.message ?? "Failed to load scratch game",
      500,
    );
  }

  if (!game) {
    throw new LotteryEftWorkflowError("Scratch game was not found", 404);
  }

  const ticketCount = normalizeTicketCount(
    inventory.pack_ticket_count ?? game.ticket_count,
  );
  const finalTicketNumber = getFinalTicketNumber(ticketCount);

  if (!ticketCount || !finalTicketNumber) {
    throw new LotteryEftWorkflowError(
      "Pack ticket count is required before settling a scratch pack to EFT.",
      400,
    );
  }

  const { data: auditRows, error: auditError } = await access.supabase
    .from("daily_audits")
    .select(
      "audit_id,inventory_id,audit_date,audit_type,bin_number,end_ticket_no,created_at",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("inventory_id", inventory.id)
    .lte("audit_date", period.weekEndDate)
    .order("audit_date", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<ScratchSettlementAuditRow[]>();

  if (auditError) {
    throw new LotteryEftWorkflowError(
      auditError.message ?? "Failed to load scratch pack audit history",
      500,
    );
  }

  const { activeIncludedAudit, soldOutAudit } = getScratchEftSettlementState(
    auditRows ?? [],
    ticketCount,
  );

  if (!soldOutAudit) {
    const activeDueDate = getActivePackSettlementDueDate({
      dateActivated: inventory.date_activated,
      timeZone: access.activeStoreTimeZone,
    });

    if (!activeDueDate) {
      throw new LotteryEftWorkflowError(
        "Active scratch pack activation date is required before 29-day EFT settlement.",
        400,
      );
    }

    if (activeDueDate > period.weekEndDate) {
      throw new LotteryEftWorkflowError(
        `This active pack is due for EFT settlement on ${activeDueDate}.`,
        409,
      );
    }
  }

  if (activeIncludedAudit) {
    throw new LotteryEftWorkflowError(
      `This pack is already settled to EFT on ${activeIncludedAudit.audit_date}.`,
      409,
    );
  }

  const isSoldOutSettlement = Boolean(soldOutAudit);
  const activeDueDate = getActivePackSettlementDueDate({
    dateActivated: inventory.date_activated,
    timeZone: access.activeStoreTimeZone,
  });
  const binNumber = soldOutAudit?.bin_number ?? inventory.bin_number;

  if (!binNumber || binNumber <= 0) {
    throw new LotteryEftWorkflowError(
      "Bin number is required before settling this pack to EFT.",
      400,
    );
  }

  const settlementDueDate = soldOutAudit?.audit_date ?? activeDueDate;

  if (!settlementDueDate) {
    throw new LotteryEftWorkflowError(
      "Scratch pack settlement due date could not be calculated.",
      500,
    );
  }

  const inclusionDate = isDateInRange(
    settlementDueDate,
    period.weekStartDate,
    period.weekEndDate,
  )
    ? settlementDueDate
    : period.weekEndDate;
  const latestTicketNumber =
    [...(auditRows ?? [])]
      .reverse()
      .map((audit) => normalizeTicketNumber(audit.end_ticket_no))
      .find((ticketNumber): ticketNumber is string => Boolean(ticketNumber)) ??
    "000";
  const markerTicketNumber = isSoldOutSettlement
    ? finalTicketNumber
    : latestTicketNumber;
  const { data: marker, error: markerError } = await access.supabase
    .from("daily_audits")
    .insert({
      audit_date: inclusionDate,
      audit_type: isSoldOutSettlement
        ? SCRATCH_EFT_SETTLEMENT_AUDIT_TYPE
        : SCRATCH_EFT_ACTIVE_29_DAY_SETTLEMENT_AUDIT_TYPE,
      bin_number: binNumber,
      calculated_revenue: 0,
      employee_id: access.currentUser.id,
      end_ticket_no: markerTicketNumber,
      inventory_id: inventory.id,
      start_ticket_no: markerTicketNumber,
      store_key: access.activeStoreKey,
      tickets_sold: 0,
    })
    .select("audit_id,audit_date")
    .single<{ audit_id: string; audit_date: string }>();

  if (markerError) {
    throw new LotteryEftWorkflowError(
      markerError.message ?? "Failed to settle scratch pack to EFT",
      500,
    );
  }

  if (isSoldOutSettlement) {
    const { data: settledInventory, error: settledInventoryError } =
      await access.supabase
        .from("inventory")
        .update({
          bin_number: null,
          status: "settled",
        })
        .eq("store_key", access.activeStoreKey)
        .eq("id", inventory.id)
        .eq("status", "sold_out")
        .select("id")
        .maybeSingle<{ id: string }>();

    if (settledInventoryError) {
      throw new LotteryEftWorkflowError(
        settledInventoryError.message ??
          "Pack was settled to EFT, but inventory could not be marked settled.",
        500,
      );
    }

    if (!settledInventory) {
      throw new LotteryEftWorkflowError(
        "Pack was settled to EFT, but inventory was already changed by another user.",
        409,
      );
    }
  }

  const ticketPrice = normalizeMoney(game.ticket_price);
  const packValue = normalizeMoney(ticketCount * ticketPrice);

  return {
    auditId: marker.audit_id,
    binNumber,
    gameId: inventory.game_id,
    gameName: game.game_name ?? "Unknown game",
    includedDate: marker.audit_date,
    inventoryId: inventory.id,
    packNumber: inventory.pack_number,
    packValue,
    pendingReason: isSoldOutSettlement ? "sold_out" : "active_29_day",
    soldOutDate: soldOutAudit?.audit_date ?? null,
    sweepDate: period.sweepDate,
    weekEndDate: period.weekEndDate,
    weekStartDate: period.weekStartDate,
  };
}

export const includeSoldOutPackInLotteryEft = includeScratchPackInLotteryEft;

export async function includeScratchPacksInLotteryEft(
  access: ScratchCardAccess,
  input: {
    inventoryIds: unknown;
    sweepDate: unknown;
  },
) {
  const rawIds = Array.isArray(input.inventoryIds) ? input.inventoryIds : [];
  const inventoryIds = Array.from(
    new Set(
      rawIds
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );

  if (inventoryIds.length === 0) {
    throw new LotteryEftWorkflowError("At least one inventory id is required");
  }

  if (inventoryIds.length > 100) {
    throw new LotteryEftWorkflowError(
      "Bulk settlement is limited to 100 packs at a time",
      400,
    );
  }

  const settled: Array<
    Awaited<ReturnType<typeof includeScratchPackInLotteryEft>>
  > = [];
  const failed: Array<{ error: string; inventoryId: string }> = [];

  for (const inventoryId of inventoryIds) {
    try {
      settled.push(
        await includeScratchPackInLotteryEft(access, {
          inventoryId,
          sweepDate: input.sweepDate,
        }),
      );
    } catch (error) {
      if (error instanceof LotteryEftWorkflowError) {
        failed.push({
          error: error.message,
          inventoryId,
        });
        continue;
      }

      throw error;
    }
  }

  return {
    failed,
    settled,
  };
}

export async function reverseSoldOutPackLotteryEft(
  access: ScratchCardAccess,
  input: {
    inventoryId: unknown;
    reason: unknown;
  },
) {
  const inventoryId = normalizeRequiredText(input.inventoryId, "Inventory id");
  const reason = normalizeRequiredText(input.reason, "Reversal reason");

  const { data: inventory, error: inventoryError } = await access.supabase
    .from("inventory")
    .select(
      "id,game_id,pack_number,pack_ticket_count,bin_number,date_activated,status,updated_at",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("id", inventoryId)
    .maybeSingle<SoldOutPackInventoryRow>();

  if (inventoryError) {
    throw new LotteryEftWorkflowError(
      inventoryError.message ?? "Failed to load scratch pack",
      500,
    );
  }

  if (!inventory) {
    throw new LotteryEftWorkflowError("Scratch pack was not found", 404);
  }

  if (
    inventory.status !== "settled" &&
    inventory.status !== "sold_out" &&
    inventory.status !== "active"
  ) {
    throw new LotteryEftWorkflowError(
      "Only settled scratch packs can be reversed from EFT.",
      409,
    );
  }

  const { data: game, error: gameError } = await access.supabase
    .from("game_catalog")
    .select("game_id,game_name,ticket_count,ticket_price")
    .eq("game_id", inventory.game_id)
    .maybeSingle<SoldOutPackGameRow>();

  if (gameError) {
    throw new LotteryEftWorkflowError(
      gameError.message ?? "Failed to load scratch game",
      500,
    );
  }

  if (!game) {
    throw new LotteryEftWorkflowError("Scratch game was not found", 404);
  }

  const ticketCount = normalizeTicketCount(
    inventory.pack_ticket_count ?? game.ticket_count,
  );
  const finalTicketNumber = getFinalTicketNumber(ticketCount);

  if (!ticketCount || !finalTicketNumber) {
    throw new LotteryEftWorkflowError(
      "Pack ticket count is required before reversing EFT settlement.",
      400,
    );
  }

  const { data: auditRows, error: auditError } = await access.supabase
    .from("daily_audits")
    .select(
      "audit_id,inventory_id,audit_date,audit_type,bin_number,end_ticket_no,created_at",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("inventory_id", inventory.id)
    .order("audit_date", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<ScratchSettlementAuditRow[]>();

  if (auditError) {
    throw new LotteryEftWorkflowError(
      auditError.message ?? "Failed to load EFT settlement history",
      500,
    );
  }

  const { activeIncludedAudit, soldOutAudit } = getScratchEftSettlementState(
    auditRows ?? [],
    ticketCount,
  );

  if (!activeIncludedAudit) {
    throw new LotteryEftWorkflowError(
      "This scratch pack does not have an active EFT settlement to reverse.",
      409,
    );
  }

  const isActive29DaySettlement = isScratchEftActive29DaySettlementAudit(
    activeIncludedAudit.audit_type,
  );
  const includedSweepDate = getLotteryEftSweepDateForReportDate(
    activeIncludedAudit.audit_date,
  );

  if (!includedSweepDate) {
    throw new LotteryEftWorkflowError(
      "The original EFT settlement date is invalid.",
      500,
    );
  }

  const statusResult = await access.supabase
    .from("lottery_eft_weekly_status")
    .select("status")
    .eq("store_key", access.activeStoreKey)
    .eq("sweep_date", includedSweepDate)
    .maybeSingle<{ status: LotteryEftPaymentStatus }>();

  if (
    statusResult.error &&
    !isMissingEftWeeklyStatusTableError(statusResult.error)
  ) {
    throw new LotteryEftWorkflowError(
      statusResult.error.message ?? "Failed to check EFT payment status",
      500,
    );
  }

  if (statusResult.data?.status === "paid") {
    throw new LotteryEftWorkflowError(
      "Mark the original EFT week unpaid before reversing this pack.",
      409,
    );
  }

  const periodLock = await assertAccountingPeriodUnlocked(
    access.supabase,
    access.activeStoreKey,
    activeIncludedAudit.audit_date,
    "Lottery EFT pack settlement reversal",
  );

  if (periodLock) {
    throw new LotteryEftWorkflowError(periodLock.error, periodLock.status);
  }

  const binNumber =
    activeIncludedAudit.bin_number ??
    soldOutAudit?.bin_number ??
    inventory.bin_number;

  if (!binNumber || binNumber <= 0) {
    throw new LotteryEftWorkflowError(
      "Original bin number is required before reversing this settlement.",
      400,
    );
  }

  const markerTicketNumber =
    (isActive29DaySettlement
      ? normalizeTicketNumber(activeIncludedAudit.end_ticket_no)
      : finalTicketNumber) ?? "000";
  const { data: reversal, error: reversalError } = await access.supabase
    .from("daily_audits")
    .insert({
      audit_date: activeIncludedAudit.audit_date,
      audit_type: SCRATCH_EFT_SETTLEMENT_REVERSAL_AUDIT_TYPE,
      bin_number: binNumber,
      calculated_revenue: 0,
      employee_id: access.currentUser.id,
      end_ticket_no: markerTicketNumber,
      inventory_id: inventory.id,
      start_ticket_no: markerTicketNumber,
      store_key: access.activeStoreKey,
      tickets_sold: 0,
    })
    .select("audit_id,audit_date")
    .single<{ audit_id: string; audit_date: string }>();

  if (reversalError) {
    throw new LotteryEftWorkflowError(
      reversalError.message ?? "Failed to reverse EFT settlement",
      500,
    );
  }

  if (!isActive29DaySettlement) {
    const { data: reversedInventory, error: reversedInventoryError } =
      await access.supabase
        .from("inventory")
        .update({
          bin_number: null,
          status: "sold_out",
        })
        .eq("store_key", access.activeStoreKey)
        .eq("id", inventory.id)
        .in("status", ["settled", "sold_out"])
        .select("id")
        .maybeSingle<{ id: string }>();

    if (reversedInventoryError) {
      throw new LotteryEftWorkflowError(
        reversedInventoryError.message ??
          "Settlement was reversed, but inventory could not be marked sold out.",
        500,
      );
    }

    if (!reversedInventory) {
      throw new LotteryEftWorkflowError(
        "Settlement was reversed, but inventory was already changed by another user.",
        409,
      );
    }
  }

  const ticketPrice = normalizeMoney(game.ticket_price);
  const packValue = normalizeMoney(ticketCount * ticketPrice);
  const includedPeriod = getLotteryEftSweepPeriod(includedSweepDate);

  return {
    auditId: reversal.audit_id,
    binNumber,
    gameId: inventory.game_id,
    gameName: game.game_name ?? "Unknown game",
    includedAuditId: activeIncludedAudit.audit_id ?? null,
    includedDate: activeIncludedAudit.audit_date,
    inventoryId: inventory.id,
    packNumber: inventory.pack_number,
    packValue,
    pendingReason: isActive29DaySettlement ? "active_29_day" : "sold_out",
    reason,
    reversedDate: reversal.audit_date,
    soldOutDate: soldOutAudit?.audit_date ?? null,
    sweepDate: includedSweepDate,
    weekEndDate: includedPeriod.weekEndDate,
    weekStartDate: includedPeriod.weekStartDate,
  };
}

export async function updateLotteryEftWeeklyStatus(
  access: ScratchCardAccess,
  input: {
    paidAmount?: unknown;
    paidNotes?: unknown;
    paidReference?: unknown;
    status: unknown;
    sweepDate: unknown;
  },
) {
  const status = normalizePaymentStatus(input.status);
  const paidAmount =
    status === "paid" ? parseRequiredPaidAmount(input.paidAmount) : null;
  const paidReference =
    status === "paid"
      ? normalizeOptionalEvidenceText(input.paidReference)
      : null;
  const paidNotes =
    status === "paid" ? normalizeOptionalEvidenceText(input.paidNotes) : null;
  const sweepDate =
    typeof input.sweepDate === "string" ? input.sweepDate.trim() : "";

  if (status === "paid" && !paidReference && !paidNotes) {
    throw new LotteryEftWorkflowError(
      "Enter a bank reference or note before marking EFT paid",
      400,
    );
  }

  if (!isLotteryEftSweepDate(sweepDate)) {
    throw new LotteryEftWorkflowError(
      "EFT sweep date must be a Thursday date",
      400,
    );
  }

  const latestSweepDate = getLatestLotteryEftSweepDate(
    getTodayIsoDateInTimeZone(access.activeStoreTimeZone),
  );

  if (sweepDate > latestSweepDate) {
    throw new LotteryEftWorkflowError(
      `EFT sweep ${sweepDate} is not available yet. Latest available sweep is ${latestSweepDate}.`,
      409,
    );
  }

  const period = getLotteryEftSweepPeriod(sweepDate);
  const paidAt = status === "paid" ? new Date().toISOString() : null;
  const { data, error } = await access.supabase
    .from("lottery_eft_weekly_status")
    .upsert(
      {
        marked_by: access.currentUser.id,
        paid_amount: paidAmount,
        paid_at: paidAt,
        paid_notes: paidNotes,
        paid_reference: paidReference,
        status,
        store_key: access.activeStoreKey,
        sweep_date: period.sweepDate,
        week_end_date: period.weekEndDate,
        week_start_date: period.weekStartDate,
      },
      {
        onConflict: "store_key,sweep_date",
      },
    )
    .select(
      "week_start_date,week_end_date,sweep_date,status,paid_at,paid_amount,paid_reference,paid_notes,marked_by",
    )
    .single<EftWeeklyStatusRow>();

  if (error) {
    if (isMissingEftWeeklyStatusTableError(error)) {
      throw new LotteryEftWorkflowError(
        "Apply the latest Supabase migration before saving EFT paid status",
        500,
      );
    }

    if (isMissingEftPaidAmountColumnError(error)) {
      throw new LotteryEftWorkflowError(
        "Apply the latest Supabase migration before saving EFT paid amounts",
        500,
      );
    }

    if (isMissingEftEvidenceColumnError(error)) {
      throw new LotteryEftWorkflowError(
        "Apply the latest Supabase migration before saving EFT payment evidence",
        500,
      );
    }

    throw new LotteryEftWorkflowError(
      error.message ?? "Failed to update EFT paid status",
      500,
    );
  }

  return {
    paidAmount: normalizeOptionalLotteryEftPaidAmount(data.paid_amount),
    paidAt: data.paid_at,
    paidNotes: data.paid_notes?.trim() || null,
    paidReference: data.paid_reference?.trim() || null,
    paymentStatus: data.status,
    sweepDate: data.sweep_date,
    weekEndDate: data.week_end_date,
    weekStartDate: data.week_start_date,
  };
}
