import assert from "node:assert/strict";
import test from "node:test";
import { calculateLotteryEftFormula } from "./eft-calculation.ts";
import {
  getLatestLotteryEftSweepDate,
  getLotteryEftSweepPeriod,
  getLotteryEftSweepPeriods,
} from "./eft-periods.ts";

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

export {};
