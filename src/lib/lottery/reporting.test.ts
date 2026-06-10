import assert from "node:assert/strict";
import test from "node:test";
import { buildGameRows } from "./reporting-game-performance.ts";

test("scratch game performance includes sales-producing shift and retirement audits", () => {
  const rows = buildGameRows({
    auditRows: [
      {
        audit_type: "eod",
        bin_number: 1,
        calculated_revenue: 50,
        inventory_id: "pack-a",
        tickets_sold: 999,
      },
      {
        audit_type: "shift",
        bin_number: 1,
        calculated_revenue: 20,
        inventory_id: "pack-a",
        tickets_sold: 2,
      },
      {
        audit_type: "bin_load_retirement",
        bin_number: 2,
        calculated_revenue: 15,
        inventory_id: "pack-b",
        tickets_sold: 3,
      },
      {
        audit_type: "opening",
        bin_number: 3,
        calculated_revenue: 100,
        inventory_id: "pack-c",
        tickets_sold: 10,
      },
      {
        audit_type: "eod",
        bin_number: 4,
        calculated_revenue: 0,
        inventory_id: "pack-d",
        tickets_sold: 0,
      },
    ],
    gameById: new Map([
      [
        "game-a",
        {
          game_id: "game-a",
          game_name: "Game A",
          image_url: null,
          ticket_price: 10,
        },
      ],
      [
        "game-b",
        {
          game_id: "game-b",
          game_name: "Game B",
          image_url: null,
          ticket_price: 5,
        },
      ],
    ]),
    inventoryById: new Map([
      [
        "pack-a",
        {
          bin_number: 1,
          game_id: "game-a",
          id: "pack-a",
          pack_id: "game-a-pack-a",
          pack_number: "000001",
          status: "active",
        },
      ],
      [
        "pack-b",
        {
          bin_number: 2,
          game_id: "game-b",
          id: "pack-b",
          pack_id: "game-b-pack-b",
          pack_number: "000002",
          status: "settled",
        },
      ],
      [
        "pack-c",
        {
          bin_number: 3,
          game_id: "game-a",
          id: "pack-c",
          pack_id: "game-a-pack-c",
          pack_number: "000003",
          status: "active",
        },
      ],
      [
        "pack-d",
        {
          bin_number: 4,
          game_id: "game-a",
          id: "pack-d",
          pack_id: "game-a-pack-d",
          pack_number: "000004",
          status: "active",
        },
      ],
    ]),
  });

  assert.deepEqual(
    rows.map((row) => ({
      auditCount: row.auditCount,
      gameId: row.gameId,
      scratchSales: row.scratchSales,
      ticketsSold: row.ticketsSold,
    })),
    [
      {
        auditCount: 2,
        gameId: "game-a",
        scratchSales: 70,
        ticketsSold: 7,
      },
      {
        auditCount: 1,
        gameId: "game-b",
        scratchSales: 15,
        ticketsSold: 3,
      },
    ],
  );
});
