export type ScratchSettlementAuditRow = {
  audit_id?: string;
  audit_date: string;
  audit_type: string | null;
  bin_number?: number | null;
  created_at: string;
  end_ticket_no: string | null;
  inventory_id: string | null;
};

export type ScratchSettlementInventoryRow = {
  date_activated?: string | null;
  game_id: string;
  id: string;
  pack_ticket_count: number | string | null;
};

export type ScratchSettlementGameRow = {
  game_id: string;
  ticket_count: number | string | null;
  ticket_price: number | string | null;
};

export type ScratchPackSettlementSale = {
  inventoryId: string;
  packValue: number;
  reportDate: string;
};

export const SCRATCH_EFT_SETTLEMENT_AUDIT_TYPE = "bin_load_retirement";
export const SCRATCH_EFT_ACTIVE_29_DAY_SETTLEMENT_AUDIT_TYPE =
  "active_29_day_settlement";
export const SCRATCH_EFT_SETTLEMENT_REVERSAL_AUDIT_TYPE =
  "eft_settlement_reversal";

function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
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

export function isScratchEftSettlementAudit(
  auditType: string | null | undefined,
) {
  return auditType === SCRATCH_EFT_SETTLEMENT_AUDIT_TYPE;
}

export function isScratchEftActive29DaySettlementAudit(
  auditType: string | null | undefined,
) {
  return auditType === SCRATCH_EFT_ACTIVE_29_DAY_SETTLEMENT_AUDIT_TYPE;
}

export function isScratchEftSettlementReversalAudit(
  auditType: string | null | undefined,
) {
  return auditType === SCRATCH_EFT_SETTLEMENT_REVERSAL_AUDIT_TYPE;
}

function addDaysToIsoDateKey(value: string | null | undefined, days: number) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getImplicitActiveSettlementDate(
  dateActivated: string | null | undefined,
) {
  if (!dateActivated) {
    return null;
  }

  return addDaysToIsoDateKey(dateActivated, 29);
}

export function buildScratchPackSettlementSales({
  auditRows,
  endDate,
  gameRows,
  inventoryRows,
  startDate,
}: {
  auditRows: ScratchSettlementAuditRow[];
  endDate: string;
  gameRows: ScratchSettlementGameRow[];
  inventoryRows: ScratchSettlementInventoryRow[];
  startDate: string;
}) {
  const gameById = new Map(gameRows.map((game) => [game.game_id, game]));
  const inventoryById = new Map(
    inventoryRows.map((inventory) => [inventory.id, inventory]),
  );
  const sortedAudits = [...auditRows].sort(
    (left, right) =>
      left.audit_date.localeCompare(right.audit_date) ||
      left.created_at.localeCompare(right.created_at),
  );
  const settlementByInventory = new Map<string, ScratchPackSettlementSale>();

  for (const audit of sortedAudits) {
    if (!audit.inventory_id) {
      continue;
    }

    if (isScratchEftSettlementReversalAudit(audit.audit_type)) {
      settlementByInventory.delete(audit.inventory_id);
      continue;
    }

    if (settlementByInventory.has(audit.inventory_id)) {
      continue;
    }

    const isSoldOutSettlement = isScratchEftSettlementAudit(audit.audit_type);
    const isActive29DaySettlement = isScratchEftActive29DaySettlementAudit(
      audit.audit_type,
    );

    if (!isSoldOutSettlement && !isActive29DaySettlement) {
      continue;
    }

    const inventory = inventoryById.get(audit.inventory_id);
    const game = inventory ? gameById.get(inventory.game_id) : null;
    const ticketCount = normalizeTicketCount(
      inventory?.pack_ticket_count ?? game?.ticket_count,
    );
    const endTicketNumber = normalizeTicketNumber(audit.end_ticket_no);

    if (!inventory || !game || !ticketCount) {
      continue;
    }

    if (isSoldOutSettlement) {
      if (!endTicketNumber) {
        continue;
      }

      const finalTicketValue = ticketCount - 1;

      if (Number(endTicketNumber) < finalTicketValue) {
        continue;
      }
    }

    settlementByInventory.set(audit.inventory_id, {
      inventoryId: audit.inventory_id,
      packValue: normalizeMoney(
        ticketCount * normalizeMoney(game.ticket_price),
      ),
      reportDate: audit.audit_date,
    });
  }

  for (const inventory of inventoryRows) {
    if (!inventory.id || settlementByInventory.has(inventory.id)) {
      continue;
    }

    const relevantAuditHistory = sortedAudits.filter(
      (audit) => audit.inventory_id === inventory.id,
    );
    const lastRelevantAudit = relevantAuditHistory.at(-1);

    if (
      lastRelevantAudit &&
      (isScratchEftSettlementAudit(lastRelevantAudit.audit_type) ||
        isScratchEftActive29DaySettlementAudit(lastRelevantAudit.audit_type))
    ) {
      continue;
    }

    if (
      lastRelevantAudit &&
      isScratchEftSettlementReversalAudit(lastRelevantAudit.audit_type)
    ) {
      continue;
    }

    const implicitSettlementDate = getImplicitActiveSettlementDate(
      inventory.date_activated,
    );

    if (!implicitSettlementDate) {
      continue;
    }

    const game = gameById.get(inventory.game_id);
    const ticketCount = normalizeTicketCount(
      inventory.pack_ticket_count ?? game?.ticket_count,
    );

    if (!game || !ticketCount) {
      continue;
    }

    if (implicitSettlementDate < startDate || implicitSettlementDate > endDate) {
      continue;
    }

    settlementByInventory.set(inventory.id, {
      inventoryId: inventory.id,
      packValue: normalizeMoney(ticketCount * normalizeMoney(game.ticket_price)),
      reportDate: implicitSettlementDate,
    });
  }

  return [...settlementByInventory.values()].filter(
    (settlement) =>
      settlement.reportDate >= startDate && settlement.reportDate <= endDate,
  );
}

export function sumScratchPackSettlementsByDate(
  settlementRows: ScratchPackSettlementSale[],
) {
  return settlementRows.reduce<Map<string, number>>((byDate, settlement) => {
    byDate.set(
      settlement.reportDate,
      normalizeMoney(
        (byDate.get(settlement.reportDate) ?? 0) + settlement.packValue,
      ),
    );

    return byDate;
  }, new Map<string, number>());
}
