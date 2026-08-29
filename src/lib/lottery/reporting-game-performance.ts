export type ScratchGamePerformanceAuditRow = {
  audit_type: string | null;
  bin_number: number;
  calculated_revenue: number | string;
  inventory_id: string | null;
  tickets_sold: number | string;
};

export type ScratchGamePerformanceInventoryRow = {
  bin_number: number | null;
  game_id: string;
  id: string;
  pack_number: string;
};

export type ScratchGamePerformanceCatalogRow = {
  game_id: string;
  game_name: string;
  image_url: string | null;
  ticket_price: number | string;
};

export type ScratchGamePerformanceRow = {
  auditCount: number;
  binCount: number;
  gameId: string;
  gameName: string;
  imageUrl: string | null;
  packCount: number;
  scratchSales: number;
  ticketPrice: number;
  ticketsSold: number;
};

export const SCRATCH_GAME_PERFORMANCE_AUDIT_TYPES = new Set([
  "eod",
  "shift",
  "bin_load_retirement",
]);

function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function normalizeInteger(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.max(Math.trunc(normalized), 0) : 0;
}

function hasScratchGamePerformanceMovement(
  audit: ScratchGamePerformanceAuditRow,
) {
  return (
    normalizeInteger(audit.tickets_sold) > 0 ||
    normalizeMoney(audit.calculated_revenue) > 0
  );
}

function calculateScratchGamePerformanceTicketsSold({
  scratchSales,
  storedTicketsSold,
  ticketPrice,
}: {
  scratchSales: number;
  storedTicketsSold: number;
  ticketPrice: number;
}) {
  if (ticketPrice > 0 && scratchSales > 0) {
    return Math.max(Math.round(scratchSales / ticketPrice), 0);
  }

  return storedTicketsSold;
}

export function buildGameRows({
  auditRows,
  gameById,
  inventoryById,
}: {
  auditRows: ScratchGamePerformanceAuditRow[];
  gameById: Map<string, ScratchGamePerformanceCatalogRow>;
  inventoryById: Map<string, ScratchGamePerformanceInventoryRow>;
}): ScratchGamePerformanceRow[] {
  type GameAccumulator = {
    auditCount: number;
    bins: Set<number>;
    gameId: string;
    gameName: string;
    imageUrl: string | null;
    packs: Set<string>;
    scratchSales: number;
    storedTicketsSold: number;
    ticketPrice: number;
  };

  const gameMap = new Map<string, GameAccumulator>();

  auditRows.forEach((audit) => {
    if (
      !SCRATCH_GAME_PERFORMANCE_AUDIT_TYPES.has(audit.audit_type ?? "") ||
      !hasScratchGamePerformanceMovement(audit)
    ) {
      return;
    }

    const inventory = audit.inventory_id
      ? inventoryById.get(audit.inventory_id)
      : undefined;
    const gameId = inventory?.game_id ?? "unknown";
    const game = gameById.get(gameId);
    const accumulator =
      gameMap.get(gameId) ??
      ({
        auditCount: 0,
        bins: new Set<number>(),
        gameId,
        gameName: game?.game_name ?? "Unknown game",
        imageUrl: game?.image_url ?? null,
        packs: new Set<string>(),
        scratchSales: 0,
        storedTicketsSold: 0,
        ticketPrice: normalizeMoney(game?.ticket_price),
      } satisfies GameAccumulator);

    accumulator.auditCount += 1;
    accumulator.bins.add(audit.bin_number);
    accumulator.scratchSales = normalizeMoney(
      accumulator.scratchSales + normalizeMoney(audit.calculated_revenue),
    );
    accumulator.storedTicketsSold += normalizeInteger(audit.tickets_sold);

    if (inventory?.pack_number) {
      accumulator.packs.add(inventory.pack_number);
    }

    gameMap.set(gameId, accumulator);
  });

  return Array.from(gameMap.values())
    .map((row) => ({
      auditCount: row.auditCount,
      binCount: row.bins.size,
      gameId: row.gameId,
      gameName: row.gameName,
      imageUrl: row.imageUrl,
      packCount: row.packs.size,
      scratchSales: row.scratchSales,
      ticketPrice: row.ticketPrice,
      ticketsSold: calculateScratchGamePerformanceTicketsSold({
        scratchSales: row.scratchSales,
        storedTicketsSold: row.storedTicketsSold,
        ticketPrice: row.ticketPrice,
      }),
    }))
    .sort((left, right) => right.scratchSales - left.scratchSales);
}
