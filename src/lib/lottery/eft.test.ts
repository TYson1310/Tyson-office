import assert from "node:assert/strict";
import test from "node:test";
import { calculateLotteryEftFormula } from "./eft-calculation.ts";
import {
  getLatestLotteryEftSweepDate,
  getLotteryEftSweepPeriod,
  getLotteryEftSweepPeriods,
} from "./eft-periods.ts";
import { buildScratchPackSettlementSales } from "./scratch-pack-settlements.ts";

test("getLotteryEftSweepPeriod uses Thursday through Wednesday for Thursday sweep", () => {
  assert.deepEqual(getLotteryEftSweepPeriod("2026-05-14"), {
    sweepDate: "2026-05-14",
    weekEndDate: "2026-05-13",
    weekStartDate: "2026-05-07",
  });
});

test("getLatestLotteryEftSweepDate returns the payable Thursday on or before the date", () => {
  assert.equal(getLatestLotteryEftSweepDate("2026-05-14"), "2026-05-14");
  assert.equal(getLatestLotteryEftSweepDate("2026-05-15"), "2026-05-14");
  assert.equal(getLatestLotteryEftSweepDate("2026-05-13"), "2026-05-07");
});

test("getLotteryEftSweepPeriods lists closed EFT weeks newest first", () => {
  assert.deepEqual(
    getLotteryEftSweepPeriods({
      latestSweepDate: "2026-05-14",
      weeks: 3,
    }),
    [
      {
        sweepDate: "2026-05-14",
        weekEndDate: "2026-05-13",
        weekStartDate: "2026-05-07",
      },
      {
        sweepDate: "2026-05-07",
        weekEndDate: "2026-05-06",
        weekStartDate: "2026-04-30",
      },
      {
        sweepDate: "2026-04-30",
        weekEndDate: "2026-04-29",
        weekStartDate: "2026-04-23",
      },
    ],
  );
});

test("calculateLotteryEftFormula follows the Thursday sweep net due formula", () => {
  const result = calculateLotteryEftFormula({
    grossSales: 450,
    payoutCommissionRate: 1,
    prizePayouts: 185,
    retailerCommissionRate: 5,
    ticketCancels: 12,
  });

  assert.deepEqual(result, {
    administrativeFees: 0,
    bondingFee: 0,
    grossSales: 450,
    netEftDue: 229.25,
    netTicketSales: 438,
    payoutCommissionCredit: 1.85,
    promoCredits: 0,
    retailerCommissionCredit: 21.9,
    ticketCancels: 12,
    totalCommissions: 23.75,
    totalCredits: 220.75,
    totalPayouts: 185,
  });
});

test("calculateLotteryEftFormula subtracts PROMO credits from net due", () => {
  const result = calculateLotteryEftFormula({
    grossSales: 450,
    payoutCommissionRate: 1,
    promoCredits: 20,
    prizePayouts: 185,
    retailerCommissionRate: 5,
    ticketCancels: 12,
  });

  assert.equal(result.promoCredits, 20);
  assert.equal(result.totalCredits, 240.75);
  assert.equal(result.netEftDue, 209.25);
});

test("calculateLotteryEftFormula adds bonding and administrative fees", () => {
  const result = calculateLotteryEftFormula({
    administrativeFees: 2.5,
    bondingFee: 1.25,
    grossSales: 100,
    payoutCommissionRate: 1,
    prizePayouts: 10,
    retailerCommissionRate: 5,
    ticketCancels: 0,
  });

  assert.equal(result.netEftDue, 88.65);
});

test("buildScratchPackSettlementSales counts a pack when it first reaches final ticket", () => {
  const settlements = buildScratchPackSettlementSales({
    auditRows: [
      {
        audit_date: "2026-05-25",
        created_at: "2026-05-25T23:00:00.000Z",
        end_ticket_no: "016",
        inventory_id: "pack-1",
      },
      {
        audit_date: "2026-05-26",
        created_at: "2026-05-26T15:00:00.000Z",
        end_ticket_no: "019",
        inventory_id: "pack-1",
      },
      {
        audit_date: "2026-05-26",
        created_at: "2026-05-26T16:00:00.000Z",
        end_ticket_no: "019",
        inventory_id: "pack-1",
      },
    ],
    endDate: "2026-05-26",
    gameRows: [
      {
        game_id: "01974",
        ticket_count: 20,
        ticket_price: 20,
      },
    ],
    inventoryRows: [
      {
        game_id: "01974",
        id: "pack-1",
        pack_ticket_count: null,
      },
    ],
    startDate: "2026-05-26",
  });

  assert.deepEqual(settlements, [
    {
      inventoryId: "pack-1",
      packValue: 400,
      reportDate: "2026-05-26",
    },
  ]);
});

test("buildScratchPackSettlementSales skips packs that reached final ticket before the range", () => {
  const settlements = buildScratchPackSettlementSales({
    auditRows: [
      {
        audit_date: "2026-05-24",
        created_at: "2026-05-24T22:00:00.000Z",
        end_ticket_no: "019",
        inventory_id: "pack-1",
      },
      {
        audit_date: "2026-05-26",
        created_at: "2026-05-26T15:00:00.000Z",
        end_ticket_no: "019",
        inventory_id: "pack-1",
      },
    ],
    endDate: "2026-05-26",
    gameRows: [
      {
        game_id: "01974",
        ticket_count: 20,
        ticket_price: 20,
      },
    ],
    inventoryRows: [
      {
        game_id: "01974",
        id: "pack-1",
        pack_ticket_count: null,
      },
    ],
    startDate: "2026-05-25",
  });

  assert.deepEqual(settlements, []);
});

export {};
