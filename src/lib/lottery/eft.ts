import {
  enumerateIsoDateRange,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";
import type { ScratchCardAccess } from "@/lib/scratch-cards/api";
import { calculateLotteryEftFormula } from "./eft-calculation";
import {
  calculateAppliedLotteryEftPayment,
  normalizeOptionalLotteryEftPaidAmount,
} from "./eft-paid-amount";
import {
  getLatestLotteryEftSweepDate,
  getLotteryEftSweepPeriod,
  getLotteryEftSweepPeriods,
  isLotteryEftSweepDate,
} from "./eft-periods";

type DailyAuditRow = {
  audit_date: string;
  calculated_revenue: number | string;
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
  audit_date: string;
  created_at: string;
  end_ticket_no: string;
  inventory_id: string;
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
  totalPackValue: number;
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
  thursdaySweep: LotteryEftThursdaySweep;
  transactions: LotteryEftTransactionRow[];
  weekEndDate: string;
  weekStartDate: string;
  weeklyLedger: LotteryEftWeeklyLedgerRow[];
  weeklySummary: LotteryEftWeeklySummary;
  weeks: number;
};

type LoadLotteryEftOptions = {
  sweepDate?: string;
  weeks?: number;
};

const DEFAULT_EFT_WEEKS = 8;
const MAX_EFT_WEEKS = 52;
const THURSDAY_SWEEP_AGE_DAYS = 21;
const THURSDAY_SWEEP_DEPLETION_PERCENT = 80;

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

function normalizeSelectedSweepDate(
  value: string | undefined,
  fallback: string,
) {
  const normalized = value?.trim() ?? "";

  return isLotteryEftSweepDate(normalized) && normalized <= fallback
    ? normalized
    : fallback;
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
    totalPackValue: 0,
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

function normalizeTicketNumber(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!/^[0-9]{1,3}$/.test(normalized)) {
    return null;
  }

  return String(Number(normalized)).padStart(3, "0");
}

function getLatestAuditByInventory(auditRows: InventoryAuditRow[]) {
  const latestByInventory = new Map<string, InventoryAuditRow>();

  for (const audit of auditRows) {
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
}: {
  auditRows: InventoryAuditRow[];
  endDate: string;
  gameRows: GameCatalogRow[];
  inventoryRows: ActiveInventoryRow[];
}): LotteryEftThursdaySweep {
  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const latestAuditByInventory = getLatestAuditByInventory(auditRows);
  const packs = inventoryRows.flatMap((inventory) => {
    const game = gameById.get(inventory.game_id);
    const latestAudit = latestAuditByInventory.get(inventory.id);
    const dateReceived = inventory.date_received ?? inventory.created_at;
    const daysInSystem = getDaysSince(dateReceived, endDate);
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

    if (daysInSystem > THURSDAY_SWEEP_AGE_DAYS) {
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
    totalPackValue: normalizeMoney(
      sortedPacks.reduce((total, pack) => total + (pack.packValue ?? 0), 0),
    ),
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

function buildRows({
  auditRows,
  cashingBonusRate,
  dateKeys,
  retailerCommissionRate,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  cashingBonusRate: number;
  dateKeys: string[];
  retailerCommissionRate: number;
  terminalRows: TerminalReportRow[];
}) {
  const auditsByDate = new Map<string, DailyAuditRow[]>();
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
      const scratchSales = normalizeMoney(
        (auditsByDate.get(reportDate) ?? []).reduce(
          (total, audit) => total + normalizeMoney(audit.calculated_revenue),
          0,
        ),
      );
      const drawSales = normalizeMoney(terminal?.draw_sales);
      const drawPayouts = normalizeMoney(terminal?.draw_payouts);
      const scratchPayouts = normalizeMoney(terminal?.scratch_payouts);
      const dailyBondingFee = normalizeMoney(terminal?.lottery_bonding_fee);
      const promoCredits = normalizeMoney(terminal?.total_cashing_bonus);
      const ticketCancels = normalizeMoney(terminal?.total_cancels);
      const scratchReturns = normalizeMoney(terminal?.scratch_returns);
      const eftFormula = calculateLotteryEftFormula({
        administrativeFees: 0,
        bondingFee: dailyBondingFee,
        grossSales: drawSales,
        payoutCommissionRate: cashingBonusRate,
        promoCredits,
        prizePayouts: drawPayouts + scratchPayouts,
        retailerCommissionRate,
        ticketCancels,
      });
      const {
        administrativeFees,
        bondingFee,
        grossSales,
        netEftDue,
        netTicketSales,
        payoutCommissionCredit: cashingBonusCredit,
        retailerCommissionCredit,
        totalCommissions,
        totalCredits,
        totalPayouts,
      } = eftFormula;
      const expectedCash = netTicketSales;
      const hasActivity = Boolean(terminal);
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
        label: "Gross ticket sales (S)",
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
        label: `Online sales commission ${retailerCommissionRate}%`,
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
  statusRows,
  terminalRows,
}: {
  auditRows: DailyAuditRow[];
  cashingBonusRate: number;
  periods: Array<ReturnType<typeof getLotteryEftSweepPeriod>>;
  retailerCommissionRate: number;
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
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const weeks = normalizeWeeks(options.weeks);
  const latestSweepDate = getLatestLotteryEftSweepDate(
    getTodayIsoDateInTimeZone(activeStore.timeZone),
  );
  const selectedSweepDate = normalizeSelectedSweepDate(
    options.sweepDate,
    latestSweepDate,
  );
  const selectedPeriod = getLotteryEftSweepPeriod(selectedSweepDate);
  const ledgerPeriods = getLedgerPeriods({
    latestSweepDate,
    selectedSweepDate,
    weeks,
  });
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
  const [auditResult, terminalResult, inventoryResult] = await Promise.all([
    supabase
      .from("daily_audits")
      .select("audit_date,calculated_revenue")
      .eq("store_key", activeStoreKey)
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
  ]);
  const firstError =
    auditResult.error ?? terminalResult.error ?? inventoryResult.error;

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
      thursdaySweep: buildEmptyThursdaySweep(),
      transactions: [],
      weekEndDate: selectedPeriod.weekEndDate,
      weekStartDate: selectedPeriod.weekStartDate,
      weeklyLedger: [],
      weeklySummary: emptyWeeklySummary,
      weeks,
    };
  }

  const statusResult = await loadEftWeeklyStatusRows({
    storeKey: activeStoreKey,
    supabase,
    sweepDates: ledgerPeriods.map((period) => period.sweepDate),
  });
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
      supabase
        .from("daily_audits")
        .select("inventory_id,audit_date,end_ticket_no,created_at")
        .eq("store_key", activeStoreKey)
        .in("inventory_id", inventoryIds)
        .order("audit_date", { ascending: false })
        .order("created_at", { ascending: false })
        .returns<InventoryAuditRow[]>(),
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
      endDate: selectedPeriod.weekEndDate,
      gameRows: gameResult.data ?? [],
      inventoryRows: activeInventoryRows,
    });
  }

  const { dailyRows, transactions } = buildRows({
    auditRows: auditResult.data ?? [],
    cashingBonusRate,
    dateKeys,
    retailerCommissionRate,
    terminalRows: terminalResult.data ?? [],
  });
  const weeklyLedger = buildWeeklyLedger({
    auditRows: auditResult.data ?? [],
    cashingBonusRate,
    periods: ledgerPeriods,
    retailerCommissionRate,
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
    thursdaySweep,
    transactions,
    weekEndDate: selectedPeriod.weekEndDate,
    weekStartDate: selectedPeriod.weekStartDate,
    weeklyLedger,
    weeklySummary: buildWeeklySummary(weeklyLedger),
    weeks,
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
