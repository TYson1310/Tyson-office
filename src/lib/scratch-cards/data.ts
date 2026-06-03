import {
  addDaysToIsoDateKey,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import {
  DEFAULT_STORE_SCRATCH_CARDS,
  loadStoreSettingsForStore,
} from "@/lib/store-settings";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";

type InventoryRow = {
  id: string;
  pack_id: string | null;
  pack_number: string;
  game_id: string;
  status: string;
  bin_number: number | null;
  received_ticket_number: string | null;
  pack_control_code: string | null;
  pack_ticket_count: number | null;
  date_received: string | null;
  date_activated: string | null;
  created_at: string;
};

type GameCatalogRow = {
  game_id: string;
  game_name: string;
  image_url: string | null;
  ticket_price: number | string;
  ticket_count?: number | null;
};

type AuditRow = {
  inventory_id: string;
  bin_number: number;
  audit_date: string;
  start_ticket_no: string | null;
  end_ticket_no: string;
  tickets_sold: number;
  calculated_revenue: number | string;
  audit_type: string | null;
  created_at: string;
};

export type ScratchPackDetail = {
  inventoryId: string;
  packId: string | null;
  packNumber: string;
  gameId: string;
  gameName: string | null;
  ticketPrice: number;
  gameTicketCount: number | null;
  status: string;
  receivedTicketNumber: string | null;
  packControlCode: string | null;
  packTicketCount: number | null;
  dateReceived: string | null;
  dateActivated: string | null;
  startTicketNumber: string | null;
  endTicketNumber: string | null;
  ticketsSold: number | null;
  calculatedRevenue: number | null;
  auditType: string | null;
  auditAt: string | null;
};

export type ScratchBackstockPack = {
  id: string;
  packId: string;
  packNumber: string;
  gameId: string;
  gameName: string;
  ticketPrice: number;
  gameTicketCount: number | null;
  receivedTicketNumber: string | null;
  packControlCode: string | null;
  packTicketCount: number | null;
  dateReceived: string | null;
};

export type ScratchAuditBin = {
  binNumber: number;
  inventoryId: string | null;
  isSoldOutForEod: boolean;
  packNumber: string | null;
  gameId: string | null;
  gameName: string | null;
  gameImageUrl: string | null;
  ticketPrice: number;
  lastTicketNumber: string;
  expectedDailyAverage: number;
  lastAuditAt: string | null;
  canResetTicketNumber: boolean;
  currentPack: ScratchPackDetail | null;
  lastPack: ScratchPackDetail | null;
};

export type ScratchAuditScreenData = {
  source: "database" | "unconfigured" | "error";
  storeKey: string;
  binCount: number;
  bins: ScratchAuditBin[];
  backstockPacks: ScratchBackstockPack[];
  errorMessage?: string;
};

export type ScratchDeliveryLedgerItem = {
  id: string;
  binNumber: number | null;
  dateReceived: string | null;
  gameId: string;
  gameName: string;
  gameTicketCount: number | null;
  packControlCode: string | null;
  packId: string;
  packNumber: string;
  packTicketCount: number | null;
  receivedTicketNumber: string | null;
  status: string;
  ticketPrice: number;
};

export type ScratchDeliveryLedgerData = {
  errorMessage?: string;
  ledger: ScratchDeliveryLedgerItem[];
  source: "database" | "unconfigured" | "error";
  storeKey: string;
};

function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function normalizeTicketNumber(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!/^[0-9]{1,3}$/.test(normalized)) {
    return "000";
  }

  return String(Number(normalized)).padStart(3, "0");
}

function normalizeTicketCount(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 1000) {
    return null;
  }

  return normalized;
}

function getPackTicketCount(
  inventory: InventoryRow,
  game: GameCatalogRow | undefined,
) {
  return (
    normalizeTicketCount(inventory.pack_ticket_count) ??
    normalizeTicketCount(game?.ticket_count)
  );
}

function getFinalTicketValue(
  inventory: InventoryRow,
  game: GameCatalogRow | undefined,
) {
  const ticketCount = getPackTicketCount(inventory, game);

  return ticketCount === null ? null : ticketCount - 1;
}

function isPackSoldOutForEod(
  inventory: InventoryRow,
  game: GameCatalogRow | undefined,
  audit: AuditRow | undefined,
) {
  if (!audit?.end_ticket_no) {
    return false;
  }

  const ticketCount = getPackTicketCount(inventory, game);

  if (ticketCount === null) {
    return false;
  }

  const finalTicketValue = ticketCount - 1;
  const endTicketValue = Number(normalizeTicketNumber(audit.end_ticket_no));

  if (endTicketValue < finalTicketValue || !audit.start_ticket_no) {
    return false;
  }

  const startTicketValue = Number(normalizeTicketNumber(audit.start_ticket_no));
  const ticketsSold = Number(audit.tickets_sold);

  return (
    Number.isFinite(ticketsSold) &&
    ticketsSold >= ticketCount - startTicketValue
  );
}

function getExpectedDailyAverageByBin(audits: AuditRow[]) {
  const dailyTotals = new Map<string, number>();

  for (const audit of audits) {
    const key = `${audit.bin_number}:${audit.audit_date}`;
    dailyTotals.set(
      key,
      (dailyTotals.get(key) ?? 0) + normalizeMoney(audit.calculated_revenue),
    );
  }

  const totalsByBin = new Map<number, number[]>();

  for (const [key, value] of dailyTotals.entries()) {
    const binNumber = Number(key.split(":")[0]);
    const totals = totalsByBin.get(binNumber) ?? [];

    totals.push(value);
    totalsByBin.set(binNumber, totals);
  }

  return new Map(
    Array.from(totalsByBin.entries()).map(([binNumber, totals]) => [
      binNumber,
      normalizeMoney(
        totals.reduce((sum, value) => sum + value, 0) /
          Math.max(totals.length, 1),
      ),
    ]),
  );
}

function getLatestAuditByInventory(audits: AuditRow[]) {
  const latestByInventory = new Map<string, AuditRow>();

  for (const audit of audits) {
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

function isNewerAudit(candidate: AuditRow, current: AuditRow) {
  return (
    candidate.audit_date > current.audit_date ||
    (candidate.audit_date === current.audit_date &&
      candidate.created_at > current.created_at)
  );
}

function getLatestPreviousAuditByBin(
  audits: AuditRow[],
  activeInventoryIds: Set<string>,
) {
  const latestByBin = new Map<number, AuditRow>();

  for (const audit of audits) {
    if (activeInventoryIds.has(audit.inventory_id)) {
      continue;
    }

    const current = latestByBin.get(audit.bin_number);

    if (!current || isNewerAudit(audit, current)) {
      latestByBin.set(audit.bin_number, audit);
    }
  }

  return latestByBin;
}

function getHasSoldAuditByInventory(audits: AuditRow[]) {
  const hasSoldAuditByInventory = new Map<string, boolean>();

  for (const audit of audits) {
    if (
      audit.tickets_sold > 0 ||
      normalizeMoney(audit.calculated_revenue) > 0
    ) {
      hasSoldAuditByInventory.set(audit.inventory_id, true);
    }
  }

  return hasSoldAuditByInventory;
}

function buildEmptyBins(binCount: number) {
  return Array.from({ length: binCount }, (_, index) => ({
    binNumber: index + 1,
    inventoryId: null,
    isSoldOutForEod: false,
    packNumber: null,
    gameId: null,
    gameName: null,
    gameImageUrl: null,
    ticketPrice: 0,
    lastTicketNumber: "000",
    expectedDailyAverage: 0,
    lastAuditAt: null,
    canResetTicketNumber: false,
    currentPack: null,
    lastPack: null,
  })) satisfies ScratchAuditBin[];
}

function buildPackDetail(
  inventory: InventoryRow,
  game: GameCatalogRow | undefined,
  audit: AuditRow | undefined,
) {
  return {
    inventoryId: inventory.id,
    packId: inventory.pack_id,
    packNumber: inventory.pack_number,
    gameId: inventory.game_id,
    gameName: game?.game_name ?? "Unknown game",
    ticketPrice: normalizeMoney(game?.ticket_price),
    gameTicketCount: game?.ticket_count ?? null,
    status: inventory.status,
    receivedTicketNumber: inventory.received_ticket_number,
    packControlCode: inventory.pack_control_code,
    packTicketCount: inventory.pack_ticket_count,
    dateReceived: inventory.date_received ?? inventory.created_at,
    dateActivated: inventory.date_activated,
    startTicketNumber: audit?.start_ticket_no
      ? normalizeTicketNumber(audit.start_ticket_no)
      : null,
    endTicketNumber: audit?.end_ticket_no
      ? normalizeTicketNumber(audit.end_ticket_no)
      : null,
    ticketsSold: audit?.tickets_sold ?? null,
    calculatedRevenue: audit ? normalizeMoney(audit.calculated_revenue) : null,
    auditType: audit?.audit_type ?? null,
    auditAt: audit?.created_at ?? null,
  } satisfies ScratchPackDetail;
}

function mapBackstockPacks(
  inventoryRows: InventoryRow[],
  gameById: Map<string, GameCatalogRow>,
) {
  return inventoryRows.map((inventory) => {
    const game = gameById.get(inventory.game_id);

    return {
      id: inventory.id,
      dateReceived: inventory.date_received ?? inventory.created_at,
      gameId: inventory.game_id,
      gameName: game?.game_name ?? "Unknown game",
      gameTicketCount: game?.ticket_count ?? null,
      packId:
        inventory.pack_id ?? `${inventory.game_id}-${inventory.pack_number}`,
      packNumber: inventory.pack_number,
      packControlCode: inventory.pack_control_code,
      packTicketCount: inventory.pack_ticket_count,
      receivedTicketNumber: inventory.received_ticket_number,
      ticketPrice: normalizeMoney(game?.ticket_price),
    } satisfies ScratchBackstockPack;
  });
}

function mapDeliveryLedgerItems(
  inventoryRows: InventoryRow[],
  gameById: Map<string, GameCatalogRow>,
) {
  return inventoryRows.map((inventory) => {
    const game = gameById.get(inventory.game_id);

    return {
      id: inventory.id,
      binNumber: inventory.bin_number,
      dateReceived: inventory.date_received ?? inventory.created_at,
      gameId: inventory.game_id,
      gameName: game?.game_name ?? "Unknown game",
      gameTicketCount: game?.ticket_count ?? null,
      packControlCode: inventory.pack_control_code,
      packId:
        inventory.pack_id ?? `${inventory.game_id}-${inventory.pack_number}`,
      packNumber: inventory.pack_number,
      packTicketCount: inventory.pack_ticket_count,
      receivedTicketNumber: inventory.received_ticket_number,
      status: inventory.status,
      ticketPrice: normalizeMoney(game?.ticket_price),
    } satisfies ScratchDeliveryLedgerItem;
  });
}

export async function loadScratchDeliveryLedgerData(): Promise<ScratchDeliveryLedgerData> {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();

  if (!isSupabaseConfigured()) {
    return {
      ledger: [],
      source: "unconfigured",
      storeKey: activeStoreKey,
    };
  }

  const supabase = await createClient();
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("inventory")
    .select(
      "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,created_at",
    )
    .eq("store_key", activeStoreKey)
    .in("status", ["backstock", "active", "sold_out", "settled", "returned"])
    .order("date_received", { ascending: false })
    .limit(100)
    .returns<InventoryRow[]>();

  if (inventoryError) {
    return {
      ledger: [],
      source: "error",
      storeKey: activeStoreKey,
      errorMessage:
        inventoryError.message ?? "Delivery ledger could not be loaded.",
    };
  }

  const inventory = inventoryRows ?? [];
  const gameIds = Array.from(new Set(inventory.map((row) => row.game_id)));
  let gameRows: GameCatalogRow[] = [];

  if (gameIds.length > 0) {
    const { data, error } = await supabase
      .from("game_catalog")
      .select("game_id,game_name,image_url,ticket_price,ticket_count")
      .in("game_id", gameIds)
      .returns<GameCatalogRow[]>();

    if (error) {
      return {
        ledger: [],
        source: "error",
        storeKey: activeStoreKey,
        errorMessage: error.message ?? "Game catalog data could not be loaded.",
      };
    }

    gameRows = data ?? [];
  }

  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));

  return {
    ledger: mapDeliveryLedgerItems(inventory, gameById),
    source: "database",
    storeKey: activeStoreKey,
  };
}

export async function loadScratchAuditScreenData(): Promise<ScratchAuditScreenData> {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const fallbackBinCount = DEFAULT_STORE_SCRATCH_CARDS.binCount;

  if (!isSupabaseConfigured()) {
    return {
      source: "unconfigured",
      storeKey: activeStoreKey,
      binCount: fallbackBinCount,
      bins: buildEmptyBins(fallbackBinCount),
      backstockPacks: [],
    };
  }

  const supabase = await createClient();
  const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
  const configuredBinCount = settings.scratchCards.binCount;
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("inventory")
    .select(
      "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,created_at",
    )
    .eq("store_key", activeStoreKey)
    .eq("status", "active")
    .not("bin_number", "is", null)
    .returns<InventoryRow[]>();

  if (inventoryError) {
    return {
      source: "error",
      storeKey: activeStoreKey,
      binCount: configuredBinCount,
      bins: buildEmptyBins(configuredBinCount),
      backstockPacks: [],
      errorMessage:
        inventoryError.message ??
        "Scratch card inventory could not be loaded for this store.",
    };
  }

  const activeInventory = inventoryRows ?? [];
  const maxActiveBin = activeInventory.reduce(
    (max, row) => Math.max(max, row.bin_number ?? 0),
    configuredBinCount,
  );
  const binCount = Math.max(configuredBinCount, maxActiveBin);
  const inventoryIds = activeInventory.map((row) => row.id);
  const activeInventoryIdSet = new Set(inventoryIds);
  let gameRows: GameCatalogRow[] = [];
  let auditRows: AuditRow[] = [];
  let activeInventoryAuditRows: AuditRow[] = [];
  let previousInventoryRows: InventoryRow[] = [];
  let backstockInventoryRows: InventoryRow[] = [];

  const { data: backstockData, error: backstockError } = await supabase
    .from("inventory")
    .select(
      "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,created_at",
    )
    .eq("store_key", activeStoreKey)
    .eq("status", "backstock")
    .order("date_received", { ascending: false })
    .limit(100)
    .returns<InventoryRow[]>();

  if (backstockError) {
    return {
      source: "error",
      storeKey: activeStoreKey,
      binCount,
      bins: buildEmptyBins(binCount),
      backstockPacks: [],
      errorMessage:
        backstockError.message ?? "Backstock packs could not be loaded.",
    };
  }

  backstockInventoryRows = backstockData ?? [];

  if (inventoryIds.length > 0) {
    const thirtyDaysAgo = addDaysToIsoDateKey(
      getTodayIsoDateInTimeZone(activeStore.timeZone),
      -30,
    );

    const [recentAuditResult, activeInventoryAuditResult] = await Promise.all([
      supabase
        .from("daily_audits")
        .select(
          "inventory_id,bin_number,audit_date,start_ticket_no,end_ticket_no,tickets_sold,calculated_revenue,audit_type,created_at",
        )
        .eq("store_key", activeStoreKey)
        .gte("audit_date", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(2000)
        .returns<AuditRow[]>(),
      supabase
        .from("daily_audits")
        .select(
          "inventory_id,bin_number,audit_date,start_ticket_no,end_ticket_no,tickets_sold,calculated_revenue,audit_type,created_at",
        )
        .eq("store_key", activeStoreKey)
        .in("inventory_id", inventoryIds)
        .order("audit_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000)
        .returns<AuditRow[]>(),
    ]);
    const error = recentAuditResult.error ?? activeInventoryAuditResult.error;

    if (error) {
      return {
        source: "error",
        storeKey: activeStoreKey,
        binCount,
        bins: buildEmptyBins(binCount),
        backstockPacks: [],
        errorMessage: error.message ?? "Audit history could not be loaded.",
      };
    }

    auditRows = recentAuditResult.data ?? [];
    activeInventoryAuditRows = activeInventoryAuditResult.data ?? [];
  }

  const activeAuditRows = [...auditRows, ...activeInventoryAuditRows];

  const previousAuditByBin = getLatestPreviousAuditByBin(
    auditRows,
    activeInventoryIdSet,
  );
  const previousInventoryIds = Array.from(
    new Set(
      Array.from(previousAuditByBin.values()).map(
        (audit) => audit.inventory_id,
      ),
    ),
  );

  if (previousInventoryIds.length > 0) {
    const { data, error } = await supabase
      .from("inventory")
      .select(
        "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,created_at",
      )
      .eq("store_key", activeStoreKey)
      .in("id", previousInventoryIds)
      .returns<InventoryRow[]>();

    if (error) {
      return {
        source: "error",
        storeKey: activeStoreKey,
        binCount,
        bins: buildEmptyBins(binCount),
        backstockPacks: [],
        errorMessage:
          error.message ?? "Previous pack details could not be loaded.",
      };
    }

    previousInventoryRows = data ?? [];
  }

  const gameIds = Array.from(
    new Set(
      [
        ...activeInventory,
        ...previousInventoryRows,
        ...backstockInventoryRows,
      ].map((row) => row.game_id),
    ),
  );

  if (gameIds.length > 0) {
    const { data, error } = await supabase
      .from("game_catalog")
      .select("game_id,game_name,image_url,ticket_price,ticket_count")
      .in("game_id", gameIds)
      .returns<GameCatalogRow[]>();

    if (error) {
      return {
        source: "error",
        storeKey: activeStoreKey,
        binCount,
        bins: buildEmptyBins(binCount),
        backstockPacks: [],
        errorMessage: error.message ?? "Game catalog data could not be loaded.",
      };
    }

    gameRows = data ?? [];
  }

  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const previousInventoryById = new Map(
    previousInventoryRows.map((inventory) => [inventory.id, inventory]),
  );
  const inventoryByBin = new Map(
    activeInventory
      .filter((row) => row.bin_number !== null)
      .map((row) => [row.bin_number as number, row]),
  );
  const latestAuditByInventory = getLatestAuditByInventory(activeAuditRows);
  const hasSoldAuditByInventory = getHasSoldAuditByInventory(activeAuditRows);
  const expectedAverageByBin = getExpectedDailyAverageByBin(auditRows);
  const bins = buildEmptyBins(binCount).map((bin) => {
    const inventory = inventoryByBin.get(bin.binNumber);

    if (!inventory) {
      return bin;
    }

    const game = gameById.get(inventory.game_id);
    const latestAudit = latestAuditByInventory.get(inventory.id);
    const previousAudit = previousAuditByBin.get(bin.binNumber);
    const previousInventory = previousAudit
      ? previousInventoryById.get(previousAudit.inventory_id)
      : null;
    const previousGame = previousInventory
      ? gameById.get(previousInventory.game_id)
      : undefined;

    return {
      binNumber: bin.binNumber,
      inventoryId: inventory.id,
      isSoldOutForEod: isPackSoldOutForEod(inventory, game, latestAudit),
      packNumber: inventory.pack_number,
      gameId: inventory.game_id,
      gameImageUrl: game?.image_url ?? null,
      gameName: game?.game_name ?? "Unknown game",
      ticketPrice: normalizeMoney(game?.ticket_price),
      lastTicketNumber: normalizeTicketNumber(latestAudit?.end_ticket_no),
      expectedDailyAverage: expectedAverageByBin.get(bin.binNumber) ?? 0,
      lastAuditAt: latestAudit?.created_at ?? null,
      canResetTicketNumber: Boolean(
        inventory.date_activated && !hasSoldAuditByInventory.get(inventory.id),
      ),
      currentPack: buildPackDetail(inventory, game, latestAudit),
      lastPack:
        previousInventory && previousAudit
          ? buildPackDetail(previousInventory, previousGame, previousAudit)
          : null,
    } satisfies ScratchAuditBin;
  });

  return {
    source: "database",
    storeKey: activeStoreKey,
    binCount,
    bins,
    backstockPacks: mapBackstockPacks(backstockInventoryRows, gameById),
  };
}

export async function loadScratchEodAuditScreenData(
  businessDate: string,
): Promise<ScratchAuditScreenData> {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const today = getTodayIsoDateInTimeZone(activeStore.timeZone);

  if (businessDate === today) {
    return loadScratchAuditScreenData();
  }

  const fallbackBinCount = DEFAULT_STORE_SCRATCH_CARDS.binCount;

  if (!isSupabaseConfigured()) {
    return {
      source: "unconfigured",
      storeKey: activeStoreKey,
      binCount: fallbackBinCount,
      bins: buildEmptyBins(fallbackBinCount),
      backstockPacks: [],
    };
  }

  const supabase = await createClient();
  const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
  const configuredBinCount = settings.scratchCards.binCount;
  const [activeInventoryResult, auditResult] = await Promise.all([
    supabase
      .from("inventory")
      .select(
        "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,created_at",
      )
      .eq("store_key", activeStoreKey)
      .eq("status", "active")
      .not("bin_number", "is", null)
      .returns<InventoryRow[]>(),
    supabase
      .from("daily_audits")
      .select(
        "inventory_id,bin_number,audit_date,start_ticket_no,end_ticket_no,tickets_sold,calculated_revenue,audit_type,created_at",
      )
      .eq("store_key", activeStoreKey)
      .lte("audit_date", businessDate)
      .order("audit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<AuditRow[]>(),
  ]);
  const firstError = activeInventoryResult.error ?? auditResult.error;

  if (firstError) {
    return {
      source: "error",
      storeKey: activeStoreKey,
      binCount: configuredBinCount,
      bins: buildEmptyBins(configuredBinCount),
      backstockPacks: [],
      errorMessage:
        firstError.message ?? "Scratch card history could not be loaded.",
    };
  }

  const activeInventory = activeInventoryResult.data ?? [];
  const auditRows = auditResult.data ?? [];
  const latestAuditByBin = new Map<number, AuditRow>();

  for (const audit of auditRows) {
    const current = latestAuditByBin.get(audit.bin_number);

    if (!current || isNewerAudit(audit, current)) {
      latestAuditByBin.set(audit.bin_number, audit);
    }
  }

  const activeInventoryByBin = new Map(
    activeInventory
      .filter((row) => {
        if (row.bin_number === null) {
          return false;
        }

        const activatedDate = row.date_activated?.slice(0, 10);
        return !activatedDate || activatedDate <= businessDate;
      })
      .map((row) => [row.bin_number as number, row]),
  );
  const historicalInventoryIds = Array.from(latestAuditByBin.values())
    .map((audit) => audit.inventory_id)
    .filter((inventoryId): inventoryId is string => Boolean(inventoryId));
  const inventoryIds = Array.from(
    new Set([
      ...activeInventory.map((row) => row.id),
      ...historicalInventoryIds,
    ]),
  );
  let inventoryRows: InventoryRow[] = [];

  if (inventoryIds.length > 0) {
    const { data, error } = await supabase
      .from("inventory")
      .select(
        "id,pack_id,pack_number,game_id,status,bin_number,received_ticket_number,pack_control_code,pack_ticket_count,date_received,date_activated,created_at",
      )
      .eq("store_key", activeStoreKey)
      .in("id", inventoryIds)
      .returns<InventoryRow[]>();

    if (error) {
      return {
        source: "error",
        storeKey: activeStoreKey,
        binCount: configuredBinCount,
        bins: buildEmptyBins(configuredBinCount),
        backstockPacks: [],
        errorMessage:
          error.message ??
          "Scratch card inventory history could not be loaded.",
      };
    }

    inventoryRows = data ?? [];
  }

  const inventoryById = new Map(
    [...activeInventory, ...inventoryRows].map((inventory) => [
      inventory.id,
      inventory,
    ]),
  );
  const gameIds = Array.from(
    new Set([...inventoryById.values()].map((row) => row.game_id)),
  );
  let gameRows: GameCatalogRow[] = [];

  if (gameIds.length > 0) {
    const { data, error } = await supabase
      .from("game_catalog")
      .select("game_id,game_name,image_url,ticket_price,ticket_count")
      .in("game_id", gameIds)
      .returns<GameCatalogRow[]>();

    if (error) {
      return {
        source: "error",
        storeKey: activeStoreKey,
        binCount: configuredBinCount,
        bins: buildEmptyBins(configuredBinCount),
        backstockPacks: [],
        errorMessage: error.message ?? "Game catalog data could not be loaded.",
      };
    }

    gameRows = data ?? [];
  }

  const maxHistoricalBin = Array.from(latestAuditByBin.keys()).reduce(
    (max, binNumber) => Math.max(max, binNumber),
    configuredBinCount,
  );
  const maxActiveBin = activeInventory.reduce(
    (max, row) => Math.max(max, row.bin_number ?? 0),
    maxHistoricalBin,
  );
  const binCount = Math.max(configuredBinCount, maxActiveBin);
  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const latestAuditByInventory = getLatestAuditByInventory(auditRows);
  const hasSoldAuditByInventory = getHasSoldAuditByInventory(auditRows);
  const expectedAverageByBin = getExpectedDailyAverageByBin(auditRows);
  const bins = buildEmptyBins(binCount).map((bin) => {
    const latestBinAudit = latestAuditByBin.get(bin.binNumber);
    const historicalInventory = latestBinAudit
      ? inventoryById.get(latestBinAudit.inventory_id)
      : null;
    const inventory =
      historicalInventory ?? activeInventoryByBin.get(bin.binNumber);

    if (!inventory) {
      return bin;
    }

    const game = gameById.get(inventory.game_id);
    const latestAudit =
      latestAuditByInventory.get(inventory.id) ?? latestBinAudit;

    return {
      binNumber: bin.binNumber,
      inventoryId: inventory.id,
      isSoldOutForEod: isPackSoldOutForEod(inventory, game, latestAudit),
      packNumber: inventory.pack_number,
      gameId: inventory.game_id,
      gameImageUrl: game?.image_url ?? null,
      gameName: game?.game_name ?? "Unknown game",
      ticketPrice: normalizeMoney(game?.ticket_price),
      lastTicketNumber: normalizeTicketNumber(latestAudit?.end_ticket_no),
      expectedDailyAverage: expectedAverageByBin.get(bin.binNumber) ?? 0,
      lastAuditAt: latestAudit?.created_at ?? null,
      canResetTicketNumber: Boolean(
        inventory.date_activated && !hasSoldAuditByInventory.get(inventory.id),
      ),
      currentPack: buildPackDetail(inventory, game, latestAudit),
      lastPack: null,
    } satisfies ScratchAuditBin;
  });

  return {
    source: "database",
    storeKey: activeStoreKey,
    binCount,
    bins,
    backstockPacks: [],
  };
}
