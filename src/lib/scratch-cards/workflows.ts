import type { ScratchCardAccess } from "./api";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";

export type ParsedScratchCardBarcode = {
  barcode: string;
  gameId: string;
  itemNumber: string | null;
  packNumber: string;
  scannedBarcode: string;
  ticketNumber: string;
};

type ReceivePackRow = {
  id: string;
  store_key: string;
  pack_number: string;
  game_id: string;
  status: "backstock" | "active" | "sold_out" | "settled" | "returned";
  bin_number: number | null;
  ticket_number: string;
  pack_control_code: string | null;
  pack_ticket_count: number | null;
  created_at: string;
};

type ReceivePackDateRow = {
  date_received: string | null;
};

type ReceivePackGameRow = {
  game_name: string;
  ticket_count: number | null;
  ticket_price: number | string;
};

type LoadBinRow = {
  loaded_inventory_id: string;
  loaded_pack_number: string;
  loaded_game_id: string;
  loaded_bin_number: number;
  retired_inventory_id: string | null;
  retired_pack_number: string | null;
  retired_start_ticket_number: string | null;
  retired_end_ticket_number: string | null;
  retired_tickets_sold: number | null;
  retired_sales: number | string | null;
};

type InventoryGameValidationRow = {
  id: string;
  game_id: string;
  pack_number: string;
  bin_number: number | null;
  status: string;
};

type ReconcileRow = {
  audit_id: string;
  inventory_id: string;
  game_id: string;
  pack_number: string;
  bin_number: number;
  start_ticket_number: string;
  end_ticket_number: string;
  ticket_price: number | string;
  tickets_sold: number;
  expected_sales: number | string;
  pos_sales_amount: number | string;
  short_over: number | string;
  discrepancy_status: "short" | "over" | "balanced";
};

type ActiveScratchPackRow = {
  id: string;
  game_id: string;
  pack_number: string;
  pack_ticket_count: number | string | null;
};

type ActiveBinOccupancyRow = {
  id: string;
  pack_number: string;
};

type ScratchPackGameRow = {
  ticket_count: number | string | null;
  ticket_price: number | string;
};

type LatestScratchAuditRow = {
  audit_id: string;
  end_ticket_no: string | null;
};

type SoldOutAuditRow = {
  audit_id: string;
};

type ReturnPackRow = {
  inventory_id: string;
  pack_number: string;
  game_id: string;
  bin_number: number;
  returned_ticket_count: number;
  returned_value: number | string;
  report_date: string;
};

type MoveBinRow = {
  mode: "moved" | "swapped";
  source_bin_number: number;
  target_bin_number: number;
  moved_inventory_id: string;
  moved_pack_number: string;
  moved_game_id: string;
  moved_from_bin_number: number;
  moved_to_bin_number: number;
  swapped_inventory_id: string | null;
  swapped_pack_number: string | null;
  swapped_game_id: string | null;
  swapped_from_bin_number: number | null;
  swapped_to_bin_number: number | null;
};

type AutoCarryForwardRow = {
  audit_id: string;
  inventory_id: string;
  bin_number: number;
  start_ticket_no: string;
  previous_end_ticket_no: string;
  source_audit_date: string;
  carried_forward: boolean;
};

type ReconciliationEngineRow = {
  report_date: string;
  scratch_sales: number | string;
  draw_sales: number | string;
  draw_payouts: number | string;
  scratch_payouts: number | string;
  total_expected_cash: number | string;
  pos_register_total: number | string;
  discrepancy: number | string;
};

type RpcError = {
  code?: string;
  message?: string;
};

const MIN_SCRATCH_BARCODE_DIGITS = 14;
const PACK_NUMBER_PATTERN = /^[0-9]{6}$/;
const TICKET_NUMBER_PATTERN = /^[0-9]{1,3}$/;
const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ScratchCardWorkflowError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ScratchCardWorkflowError";
    this.status = status;
  }
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function normalizeBinNumber(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new ScratchCardWorkflowError(
      "Bin number must be a positive integer",
      400,
    );
  }

  return normalized;
}

function normalizePackNumber(value: unknown) {
  const normalized = normalizeString(value);

  if (!PACK_NUMBER_PATTERN.test(normalized)) {
    throw new ScratchCardWorkflowError("Pack number must be 6 digits", 400);
  }

  return normalized;
}

function normalizeOptionalPackNumber(value: unknown) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalizePackNumber(normalized);
}

function normalizeOptionalUuid(value: unknown, label: string) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  if (!UUID_PATTERN.test(normalized)) {
    throw new ScratchCardWorkflowError(`${label} must be a valid UUID`, 400);
  }

  return normalized;
}

function normalizeTicketNumber(value: unknown, label: string) {
  const normalized = normalizeString(value);

  if (!TICKET_NUMBER_PATTERN.test(normalized)) {
    throw new ScratchCardWorkflowError(`${label} must be 1 to 3 digits`, 400);
  }

  return String(Number(normalized)).padStart(3, "0");
}

function normalizeOptionalTicketNumber(value: unknown, label: string) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalizeTicketNumber(normalized, label);
}

function normalizePosSalesAmount(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new ScratchCardWorkflowError(
      "POS sales amount must be zero or greater",
      400,
    );
  }

  return Math.round(normalized * 100) / 100;
}

function normalizeOptionalMoney(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new ScratchCardWorkflowError(`${label} must be zero or greater`, 400);
  }

  return Math.round(normalized * 100) / 100;
}

function normalizePackTicketLimit(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 1000) {
    throw new ScratchCardWorkflowError(
      "Pack ticket count must be between 1 and 1000 before it can be marked sold out",
      400,
    );
  }

  return normalized;
}

function normalizeOptionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = normalizeString(value);

  if (!ISO_DATE_PATTERN.test(normalized)) {
    throw new ScratchCardWorkflowError(`${label} must be YYYY-MM-DD`, 400);
  }

  return normalized;
}

function getTodayIsoDate(timeZone: string) {
  return getTodayIsoDateInTimeZone(timeZone);
}

function normalizeOptionalBusinessDate(
  value: unknown,
  label: string,
  timeZone: string,
) {
  const normalized = normalizeOptionalDate(value, label);

  if (!normalized) {
    return null;
  }

  if (normalized > getTodayIsoDate(timeZone)) {
    throw new ScratchCardWorkflowError(`${label} cannot be in the future`, 400);
  }

  return normalized;
}

function assertAdminBackdateAccess(
  access: ScratchCardAccess,
  businessDate: string | null,
  label: string,
) {
  if (
    !businessDate ||
    businessDate === getTodayIsoDate(access.activeStoreTimeZone)
  ) {
    return;
  }

  if (access.currentUserRole !== "admin") {
    throw new ScratchCardWorkflowError(
      `Only admins can use a past ${label}`,
      403,
    );
  }
}

function businessDateToTimestamp(value: string) {
  return `${value}T12:00:00.000Z`;
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function getDiscrepancyStatus(discrepancy: number) {
  if (discrepancy > 0) {
    return "short" as const;
  }

  if (discrepancy < 0) {
    return "over" as const;
  }

  return "balanced" as const;
}

function mapRpcError(error: RpcError, fallbackMessage: string) {
  const statusByCode: Record<string, number> = {
    "22023": 400,
    "23503": 400,
    "23505": 409,
    "42501": 403,
    P0002: 404,
  };
  const status = error.code ? (statusByCode[error.code] ?? 500) : 500;

  return new ScratchCardWorkflowError(error.message ?? fallbackMessage, status);
}

function getSingleRpcRow<T>(rows: T[] | T | null, fallbackMessage: string) {
  const row = Array.isArray(rows) ? rows[0] : rows;

  if (!row) {
    throw new ScratchCardWorkflowError(fallbackMessage, 500);
  }

  return row;
}

async function assertGameIsNotActiveInAnotherBin(
  access: ScratchCardAccess,
  input: {
    binNumber: number;
    packId: string | null;
    packNumber: string | null;
  },
) {
  let targetPackQuery = access.supabase
    .from("inventory")
    .select("id,game_id,pack_number,bin_number,status")
    .eq("store_key", access.activeStoreKey)
    .eq("status", "backstock")
    .limit(1);

  if (input.packId) {
    targetPackQuery = targetPackQuery.eq("id", input.packId);
  } else if (input.packNumber) {
    targetPackQuery = targetPackQuery
      .eq("pack_number", input.packNumber)
      .order("date_received", { ascending: false })
      .order("created_at", { ascending: false });
  }

  const { data: targetPackRows, error: targetPackError } =
    await targetPackQuery.returns<InventoryGameValidationRow[]>();

  if (targetPackError) {
    throw new ScratchCardWorkflowError(
      targetPackError.message ?? "Failed to validate scratch pack game",
      500,
    );
  }

  const targetPack = targetPackRows?.[0];

  if (!targetPack) {
    return;
  }

  const { data: duplicateRows, error: duplicateError } = await access.supabase
    .from("inventory")
    .select("id,game_id,pack_number,bin_number,status")
    .eq("store_key", access.activeStoreKey)
    .eq("status", "active")
    .eq("game_id", targetPack.game_id)
    .neq("bin_number", input.binNumber)
    .limit(1)
    .returns<InventoryGameValidationRow[]>();

  if (duplicateError) {
    throw new ScratchCardWorkflowError(
      duplicateError.message ?? "Failed to validate active scratch games",
      500,
    );
  }

  const duplicate = duplicateRows?.[0];

  if (duplicate) {
    throw new ScratchCardWorkflowError(
      `Game ${targetPack.game_id} is already active in bin ${duplicate.bin_number}. Return or settle that bin before loading the same game.`,
      409,
    );
  }
}

async function resolveBackstockPackIdFromBarcode(
  access: ScratchCardAccess,
  parsedBarcode: ParsedScratchCardBarcode,
) {
  const { data, error } = await access.supabase
    .from("inventory")
    .select("id,game_id,pack_number,bin_number,status")
    .eq("store_key", access.activeStoreKey)
    .eq("status", "backstock")
    .eq("pack_id", parsedBarcode.barcode)
    .limit(1)
    .returns<InventoryGameValidationRow[]>();

  if (error) {
    throw new ScratchCardWorkflowError(
      error.message ?? "Failed to find scanned scratch pack",
      500,
    );
  }

  const pack = data?.[0];

  if (!pack) {
    throw new ScratchCardWorkflowError(
      `Scanned pack ${parsedBarcode.packNumber} was not found in backstock`,
      404,
    );
  }

  return pack.id;
}

export function parseScratchCardBarcode(
  scannedBarcode: unknown,
): ParsedScratchCardBarcode {
  const normalized = normalizeString(scannedBarcode);
  const digitsOnly = normalized.replace(/\D/g, "");

  if (digitsOnly.length < MIN_SCRATCH_BARCODE_DIGITS) {
    throw new ScratchCardWorkflowError(
      "Invalid barcode format. Expected GGGGG-PPPPPP-TTT-IIIIIIIIII",
      400,
    );
  }

  const gameId = digitsOnly.slice(0, 5);
  const packNumber = digitsOnly.slice(5, 11);
  const ticketNumber = digitsOnly.slice(11, 14);
  const itemNumber = digitsOnly.slice(14) || null;
  const barcode = `${gameId}-${packNumber}-${ticketNumber}`;
  const displayBarcode = itemNumber ? `${barcode}-${itemNumber}` : barcode;

  return {
    barcode,
    gameId,
    itemNumber,
    packNumber,
    scannedBarcode: displayBarcode,
    ticketNumber,
  };
}

export function calculateScratchTicketSales({
  allowTicketReset = false,
  startTicketNumber,
  endTicketNumber,
  ticketPrice,
  posSalesAmount,
}: {
  allowTicketReset?: boolean;
  startTicketNumber: unknown;
  endTicketNumber: unknown;
  ticketPrice: number;
  posSalesAmount: unknown;
}) {
  const normalizedStartTicket = normalizeTicketNumber(
    startTicketNumber,
    "Start ticket number",
  );
  const normalizedEndTicket = normalizeTicketNumber(
    endTicketNumber,
    "End ticket number",
  );
  const normalizedPosSalesAmount = normalizePosSalesAmount(posSalesAmount);
  const ticketsSold =
    Number(normalizedEndTicket) - Number(normalizedStartTicket);

  if (ticketsSold < 0 && !allowTicketReset) {
    throw new ScratchCardWorkflowError(
      "End ticket number must be greater than or equal to start ticket number unless a new pack was activated",
      400,
    );
  }

  const effectiveTicketsSold =
    ticketsSold < 0 ? Number(normalizedEndTicket) : ticketsSold;
  const effectiveStartTicket = ticketsSold < 0 ? "000" : normalizedStartTicket;
  const expectedSales = normalizeMoney(effectiveTicketsSold * ticketPrice);
  const shortOver = normalizeMoney(expectedSales - normalizedPosSalesAmount);

  return {
    startTicketNumber: effectiveStartTicket,
    endTicketNumber: normalizedEndTicket,
    ticketPrice: normalizeMoney(ticketPrice),
    ticketsSold: effectiveTicketsSold,
    expectedSales,
    posSalesAmount: normalizedPosSalesAmount,
    shortOver,
    discrepancyStatus: getDiscrepancyStatus(shortOver),
  };
}

export async function receiveScratchPack(
  access: ScratchCardAccess,
  scannedBarcode: unknown,
  input?: {
    receivedDate?: unknown;
  },
) {
  const parsedBarcode = parseScratchCardBarcode(scannedBarcode);
  const receivedDate = normalizeOptionalBusinessDate(
    input?.receivedDate,
    "Delivery date",
    access.activeStoreTimeZone,
  );

  assertAdminBackdateAccess(access, receivedDate, "delivery date");

  const { data, error } = await access.supabase.rpc("receive_scratch_pack", {
    scanned_barcode: parsedBarcode.barcode,
    target_store_key: access.activeStoreKey,
  });

  if (error) {
    throw mapRpcError(error, "Failed to receive scratch pack");
  }

  const row = getSingleRpcRow(
    data as ReceivePackRow[] | null,
    "Receiving did not return inventory data",
  );
  let dateReceived = row.created_at;

  if (receivedDate) {
    const { data: receivedDateRow, error: receivedDateError } =
      await access.supabase
        .from("inventory")
        .update({ date_received: businessDateToTimestamp(receivedDate) })
        .eq("id", row.id)
        .eq("store_key", access.activeStoreKey)
        .select("date_received")
        .maybeSingle<ReceivePackDateRow>();

    if (receivedDateError) {
      throw mapRpcError(
        receivedDateError,
        "Received pack date could not be saved",
      );
    }

    dateReceived =
      receivedDateRow?.date_received ?? businessDateToTimestamp(receivedDate);
  }

  const { data: gameRow, error: gameError } = await access.supabase
    .from("game_catalog")
    .select("game_name,ticket_count,ticket_price")
    .eq("game_id", row.game_id)
    .maybeSingle<ReceivePackGameRow>();

  if (gameError) {
    throw mapRpcError(gameError, "Received pack game data could not be loaded");
  }

  return {
    barcode: parsedBarcode,
    inventory: {
      id: row.id,
      storeKey: row.store_key,
      packNumber: row.pack_number,
      gameId: row.game_id,
      status: row.status,
      binNumber: row.bin_number,
      ticketNumber: row.ticket_number,
      packControlCode: row.pack_control_code,
      packTicketCount: row.pack_ticket_count,
      gameName: gameRow?.game_name ?? null,
      gameTicketCount: gameRow?.ticket_count ?? null,
      ticketPrice: normalizeMoney(gameRow?.ticket_price),
      createdAt: row.created_at,
      dateReceived,
    },
  };
}

export async function loadScratchPackBin(
  access: ScratchCardAccess,
  input: {
    binNumber: unknown;
    packId?: unknown;
    packNumber?: unknown;
    scannedBarcode?: unknown;
    retiredEndTicketNumber?: unknown;
  },
) {
  const normalizedBinNumber = normalizeBinNumber(input.binNumber);
  const normalizedPackId = normalizeOptionalUuid(input.packId, "Pack id");
  const parsedScannedBarcode = normalizeString(input.scannedBarcode)
    ? parseScratchCardBarcode(input.scannedBarcode)
    : null;
  const normalizedPackNumber = parsedScannedBarcode
    ? parsedScannedBarcode.packNumber
    : normalizeOptionalPackNumber(input.packNumber);
  const normalizedRetiredEndTicket = normalizeOptionalTicketNumber(
    input.retiredEndTicketNumber,
    "Ending ticket number",
  );
  const resolvedPackId =
    normalizedPackId ??
    (parsedScannedBarcode
      ? await resolveBackstockPackIdFromBarcode(access, parsedScannedBarcode)
      : null);

  if (!resolvedPackId && !normalizedPackNumber) {
    throw new ScratchCardWorkflowError(
      "Pack id or pack number is required",
      400,
    );
  }

  await assertGameIsNotActiveInAnotherBin(access, {
    binNumber: normalizedBinNumber,
    packId: resolvedPackId,
    packNumber: resolvedPackId ? null : normalizedPackNumber,
  });

  const { data: activeBinRows, error: activeBinError } = await access.supabase
    .from("inventory")
    .select("id,pack_number")
    .eq("store_key", access.activeStoreKey)
    .eq("status", "active")
    .eq("bin_number", normalizedBinNumber)
    .limit(1)
    .returns<ActiveBinOccupancyRow[]>();

  if (activeBinError) {
    throw mapRpcError(activeBinError, "Active scratch bin could not be loaded");
  }

  const activeBinPack = activeBinRows?.[0] ?? null;

  if (activeBinPack) {
    throw new ScratchCardWorkflowError(
      `Mark pack ${activeBinPack.pack_number} sold out before loading a replacement into bin ${normalizedBinNumber}`,
      409,
    );
  }

  const rpcArgs: Record<string, unknown> = {
    loaded_by: access.currentUser.id,
    target_bin_number: normalizedBinNumber,
    target_store_key: access.activeStoreKey,
  };

  if (resolvedPackId) {
    rpcArgs.target_inventory_id = resolvedPackId;
  }

  if (!resolvedPackId && normalizedPackNumber) {
    rpcArgs.target_pack_number = normalizedPackNumber;
  }

  if (normalizedRetiredEndTicket) {
    rpcArgs.input_retired_end_ticket_number = normalizedRetiredEndTicket;
  }

  const { data, error } = await access.supabase.rpc(
    "load_scratch_pack_bin",
    rpcArgs,
  );

  if (error) {
    throw mapRpcError(error, "Failed to load scratch pack into bin");
  }

  const row = getSingleRpcRow(
    data as LoadBinRow[] | null,
    "Bin load did not return inventory data",
  );

  return {
    loaded: {
      inventoryId: row.loaded_inventory_id,
      packNumber: row.loaded_pack_number,
      gameId: row.loaded_game_id,
      binNumber: row.loaded_bin_number,
      status: "active" as const,
    },
    retired: row.retired_inventory_id
      ? {
          inventoryId: row.retired_inventory_id,
          packNumber: row.retired_pack_number,
          startTicketNumber: row.retired_start_ticket_number,
          endTicketNumber: row.retired_end_ticket_number,
          ticketsSold: row.retired_tickets_sold,
          sales: normalizeMoney(row.retired_sales),
          status: "settled" as const,
        }
      : null,
  };
}

export async function reconcileScratchBinShift(
  access: ScratchCardAccess,
  input: {
    binNumber: unknown;
    date?: unknown;
    startTicketNumber: unknown;
    endTicketNumber: unknown;
    posSalesAmount: unknown;
  },
) {
  const normalizedDate = normalizeOptionalBusinessDate(
    input.date,
    "Audit date",
    access.activeStoreTimeZone,
  );
  assertAdminBackdateAccess(access, normalizedDate, "audit date");
  const normalizedBinNumber = normalizeBinNumber(input.binNumber);
  const normalizedStartTicket = normalizeTicketNumber(
    input.startTicketNumber,
    "Start ticket number",
  );
  const normalizedEndTicket = normalizeTicketNumber(
    input.endTicketNumber,
    "End ticket number",
  );
  const normalizedPosSalesAmount = normalizePosSalesAmount(
    input.posSalesAmount,
  );
  const rpcArgs: Record<string, unknown> = {
    input_end_ticket_number: normalizedEndTicket,
    input_pos_sales_amount: normalizedPosSalesAmount,
    input_start_ticket_number: normalizedStartTicket,
    reconciled_by: access.currentUser.id,
    target_bin_number: normalizedBinNumber,
    target_store_key: access.activeStoreKey,
  };

  if (normalizedDate) {
    rpcArgs.target_report_date = normalizedDate;
  }

  const { data, error } = await access.supabase.rpc(
    "reconcile_scratch_bin",
    rpcArgs,
  );

  if (error) {
    throw mapRpcError(error, "Failed to reconcile scratch bin");
  }

  const row = getSingleRpcRow(
    data as ReconcileRow[] | null,
    "Reconciliation did not return audit data",
  );

  return {
    auditId: row.audit_id,
    inventoryId: row.inventory_id,
    gameId: row.game_id,
    packNumber: row.pack_number,
    binNumber: row.bin_number,
    startTicketNumber: row.start_ticket_number,
    endTicketNumber: row.end_ticket_number,
    ticketPrice: normalizeMoney(row.ticket_price),
    ticketsSold: row.tickets_sold,
    expectedSales: normalizeMoney(row.expected_sales),
    posSalesAmount: normalizeMoney(row.pos_sales_amount),
    shortOver: normalizeMoney(row.short_over),
    discrepancyStatus: row.discrepancy_status,
  };
}

export async function markScratchPackSoldOut(
  access: ScratchCardAccess,
  input: {
    binNumber: unknown;
    date?: unknown;
    startTicketNumber?: unknown;
  },
) {
  const normalizedDate = normalizeOptionalBusinessDate(
    input.date,
    "Sold out date",
    access.activeStoreTimeZone,
  );
  assertAdminBackdateAccess(access, normalizedDate, "sold out date");
  const normalizedBinNumber = normalizeBinNumber(input.binNumber);
  const submittedStartTicketNumber = normalizeOptionalTicketNumber(
    input.startTicketNumber,
    "Start ticket number",
  );
  const reportDate =
    normalizedDate ?? getTodayIsoDate(access.activeStoreTimeZone);
  const { data: activePackRows, error: activePackError } = await access.supabase
    .from("inventory")
    .select("id,game_id,pack_number,pack_ticket_count")
    .eq("store_key", access.activeStoreKey)
    .eq("status", "active")
    .eq("bin_number", normalizedBinNumber)
    .limit(1)
    .returns<ActiveScratchPackRow[]>();

  if (activePackError) {
    throw mapRpcError(
      activePackError,
      "Active scratch pack could not be loaded",
    );
  }

  const activePack = activePackRows?.[0];

  if (!activePack) {
    throw new ScratchCardWorkflowError(
      `No active scratch pack was found in bin ${normalizedBinNumber}`,
      404,
    );
  }

  const { data: gameRow, error: gameError } = await access.supabase
    .from("game_catalog")
    .select("ticket_count,ticket_price")
    .eq("game_id", activePack.game_id)
    .maybeSingle<ScratchPackGameRow>();

  if (gameError) {
    throw mapRpcError(gameError, "Scratch game data could not be loaded");
  }

  const ticketLimit = normalizePackTicketLimit(
    activePack.pack_ticket_count ?? gameRow?.ticket_count,
  );
  const finalTicketValue = ticketLimit - 1;
  const finalTicketNumber = String(finalTicketValue).padStart(3, "0");
  const ticketPrice = normalizeMoney(gameRow?.ticket_price);
  async function markInventorySoldOut() {
    const { data: statusRow, error: statusError } = await access.supabase
      .from("inventory")
      .update({ status: "sold_out" })
      .eq("store_key", access.activeStoreKey)
      .eq("id", activePack.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (statusError) {
      throw mapRpcError(statusError, "Failed to mark scratch pack sold out");
    }

    if (!statusRow) {
      throw new ScratchCardWorkflowError(
        "Scratch pack was already updated by another user",
        409,
      );
    }
  }

  const { data: latestAuditRows, error: latestAuditError } =
    await access.supabase
      .from("daily_audits")
      .select("audit_id,end_ticket_no")
      .eq("store_key", access.activeStoreKey)
      .eq("inventory_id", activePack.id)
      .lte("audit_date", reportDate)
      .order("audit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<LatestScratchAuditRow[]>();

  if (latestAuditError) {
    throw mapRpcError(
      latestAuditError,
      "Scratch audit history could not be loaded",
    );
  }

  const latestAudit = latestAuditRows?.[0] ?? null;
  const latestAuditStartTicketNumber = latestAudit?.end_ticket_no
    ? normalizeTicketNumber(latestAudit.end_ticket_no, "Latest ticket number")
    : null;
  const startTicketNumber =
    submittedStartTicketNumber ?? latestAuditStartTicketNumber ?? "000";
  const startTicketValue = Number(startTicketNumber);
  const latestAuditStartTicketValue = latestAuditStartTicketNumber
    ? Number(latestAuditStartTicketNumber)
    : null;
  const hasExistingFinalAudit =
    latestAuditStartTicketValue !== null &&
    latestAuditStartTicketValue >= finalTicketValue;

  if (
    latestAuditStartTicketValue !== null &&
    startTicketValue < latestAuditStartTicketValue
  ) {
    throw new ScratchCardWorkflowError(
      `Start ticket number cannot be lower than the latest recorded ticket ${latestAuditStartTicketNumber}`,
      409,
    );
  }

  if (hasExistingFinalAudit) {
    if (!latestAudit) {
      throw new ScratchCardWorkflowError(
        "Sold-out audit history could not be loaded",
        500,
      );
    }

    await markInventorySoldOut();

    return {
      auditId: latestAudit.audit_id,
      binNumber: normalizedBinNumber,
      discrepancyStatus: "balanced" as const,
      endTicketNumber: finalTicketNumber,
      expectedSales: 0,
      gameId: activePack.game_id,
      inventoryId: activePack.id,
      packNumber: activePack.pack_number,
      posSalesAmount: 0,
      remainingTickets: 0,
      shortOver: 0,
      status: "sold_out" as const,
      startTicketNumber: latestAuditStartTicketNumber ?? finalTicketNumber,
      ticketPrice,
      ticketsSold: 0,
    };
  }

  const remainingTickets = ticketLimit - Number(startTicketNumber);

  if (startTicketValue > finalTicketValue || remainingTickets <= 0) {
    throw new ScratchCardWorkflowError(
      `Pack ${activePack.pack_number} is already sold out`,
      409,
    );
  }

  const expectedSales = normalizeMoney(remainingTickets * ticketPrice);
  const { data: auditRow, error: auditError } = await access.supabase
    .from("daily_audits")
    .insert({
      audit_date: reportDate,
      audit_type: "shift",
      bin_number: normalizedBinNumber,
      calculated_revenue: expectedSales,
      employee_id: access.currentUser.id,
      end_ticket_no: finalTicketNumber,
      inventory_id: activePack.id,
      start_ticket_no: startTicketNumber,
      store_key: access.activeStoreKey,
      tickets_sold: remainingTickets,
    })
    .select("audit_id")
    .single<SoldOutAuditRow>();

  if (auditError) {
    throw mapRpcError(auditError, "Failed to record sold out scratch pack");
  }

  await markInventorySoldOut();

  return {
    auditId: auditRow.audit_id,
    binNumber: normalizedBinNumber,
    discrepancyStatus: "balanced" as const,
    endTicketNumber: finalTicketNumber,
    expectedSales,
    gameId: activePack.game_id,
    inventoryId: activePack.id,
    packNumber: activePack.pack_number,
    posSalesAmount: expectedSales,
    remainingTickets,
    shortOver: 0,
    status: "sold_out" as const,
    startTicketNumber,
    ticketPrice,
    ticketsSold: remainingTickets,
  };
}

export async function returnScratchPackToLottery(
  access: ScratchCardAccess,
  input: {
    binNumber?: unknown;
    inventoryId?: unknown;
  },
) {
  const normalizedInventoryId = normalizeOptionalUuid(
    input.inventoryId,
    "Inventory id",
  );
  const normalizedBinNumber =
    input.binNumber === undefined || input.binNumber === null
      ? null
      : normalizeBinNumber(input.binNumber);

  if (!normalizedInventoryId && !normalizedBinNumber) {
    throw new ScratchCardWorkflowError(
      "Inventory id or bin number is required",
      400,
    );
  }

  const { data, error } = await access.supabase.rpc(
    "return_scratch_pack_to_lottery",
    {
      returned_by: access.currentUser.id,
      target_bin_number: normalizedBinNumber,
      target_inventory_id: normalizedInventoryId,
      target_store_key: access.activeStoreKey,
    },
  );

  if (error) {
    throw mapRpcError(error, "Failed to return scratch pack");
  }

  const row = getSingleRpcRow(
    data as ReturnPackRow[] | null,
    "Return did not return inventory data",
  );

  return {
    binNumber: row.bin_number,
    gameId: row.game_id,
    inventoryId: row.inventory_id,
    packNumber: row.pack_number,
    reportDate: row.report_date,
    returnedTicketCount: row.returned_ticket_count,
    returnedValue: normalizeMoney(row.returned_value),
    status: "returned" as const,
  };
}

export async function moveActiveScratchPackBin(
  access: ScratchCardAccess,
  input: {
    sourceBinNumber: unknown;
    targetBinNumber: unknown;
  },
) {
  const sourceBinNumber = normalizeBinNumber(input.sourceBinNumber);
  const targetBinNumber = normalizeBinNumber(input.targetBinNumber);

  if (sourceBinNumber === targetBinNumber) {
    throw new ScratchCardWorkflowError(
      "Choose a different bin before moving the pack",
      400,
    );
  }

  const { data, error } = await access.supabase.rpc(
    "move_active_scratch_pack_bin",
    {
      input_source_bin_number: sourceBinNumber,
      input_target_bin_number: targetBinNumber,
      moved_by: access.currentUser.id,
      target_store_key: access.activeStoreKey,
    },
  );

  if (error) {
    throw mapRpcError(error, "Failed to move scratch pack bin");
  }

  const row = getSingleRpcRow(
    data as MoveBinRow[] | null,
    "Bin move did not return inventory data",
  );

  return {
    mode: row.mode,
    sourceBinNumber: row.source_bin_number,
    targetBinNumber: row.target_bin_number,
    moved: {
      inventoryId: row.moved_inventory_id,
      packNumber: row.moved_pack_number,
      gameId: row.moved_game_id,
      fromBinNumber: row.moved_from_bin_number,
      toBinNumber: row.moved_to_bin_number,
      status: "active" as const,
    },
    swapped: row.swapped_inventory_id
      ? {
          inventoryId: row.swapped_inventory_id,
          packNumber: row.swapped_pack_number,
          gameId: row.swapped_game_id,
          fromBinNumber: row.swapped_from_bin_number,
          toBinNumber: row.swapped_to_bin_number,
          status: "active" as const,
        }
      : null,
  };
}

export async function autoCarryForwardLotteryDay(
  access: ScratchCardAccess,
  input: {
    date?: unknown;
  } = {},
) {
  const normalizedDate = normalizeOptionalDate(input.date, "Audit date");
  const rpcArgs: Record<string, unknown> = {
    opened_by: access.currentUser.id,
    target_store_key: access.activeStoreKey,
  };

  if (normalizedDate) {
    rpcArgs.target_audit_date = normalizedDate;
  }

  const { data, error } = await access.supabase.rpc(
    "auto_carry_forward_lottery_day",
    rpcArgs,
  );

  if (error) {
    throw mapRpcError(error, "Failed to open lottery day");
  }

  const rows = (data as AutoCarryForwardRow[] | null) ?? [];

  return {
    date: normalizedDate,
    carriedForward: rows.map((row) => ({
      auditId: row.audit_id,
      inventoryId: row.inventory_id,
      binNumber: row.bin_number,
      startTicketNumber: row.start_ticket_no,
      previousEndTicketNumber: row.previous_end_ticket_no,
      sourceAuditDate: row.source_audit_date,
      carriedForward: row.carried_forward,
    })),
  };
}

export async function runLotteryReconciliationEngine(
  access: ScratchCardAccess,
  input: {
    date?: unknown;
    managerNotes?: unknown;
    posRegisterTotal?: unknown;
  } = {},
) {
  const normalizedDate = normalizeOptionalBusinessDate(
    input.date,
    "Report date",
    access.activeStoreTimeZone,
  );
  assertAdminBackdateAccess(access, normalizedDate, "report date");
  const normalizedPosRegisterTotal = normalizeOptionalMoney(
    input.posRegisterTotal,
    "POS register total",
  );
  const normalizedManagerNotes = normalizeOptionalText(input.managerNotes);
  const rpcArgs: Record<string, unknown> = {
    input_manager_notes: normalizedManagerNotes,
    input_pos_register_total: normalizedPosRegisterTotal,
    reconciled_by: access.currentUser.id,
    target_store_key: access.activeStoreKey,
  };

  if (normalizedDate) {
    rpcArgs.target_report_date = normalizedDate;
  }

  const { data, error } = await access.supabase.rpc(
    "reconciliation_engine",
    rpcArgs,
  );

  if (error) {
    throw mapRpcError(error, "Failed to run lottery reconciliation");
  }

  const row = getSingleRpcRow(
    data as ReconciliationEngineRow[] | null,
    "Lottery reconciliation did not return data",
  );

  return {
    reportDate: row.report_date,
    scratchSales: normalizeMoney(row.scratch_sales),
    drawSales: normalizeMoney(row.draw_sales),
    drawPayouts: normalizeMoney(row.draw_payouts),
    scratchPayouts: normalizeMoney(row.scratch_payouts),
    totalExpectedCash: normalizeMoney(row.total_expected_cash),
    posRegisterTotal: normalizeMoney(row.pos_register_total),
    discrepancy: normalizeMoney(row.discrepancy),
    discrepancyStatus: getDiscrepancyStatus(normalizeMoney(row.discrepancy)),
  };
}
