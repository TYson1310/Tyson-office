import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLotteryCashAdvanceImpact,
  applyLotteryCashShortOverImpact,
  calculateLotteryCashInHandFromReconciliation,
  calculateLotteryCashMovementScratchSales,
  calculateLotteryCashStatsMovement,
  calculateLotteryEodExpectedCash,
  calculateLotteryEodScratchSales,
  calculateLotteryExpectedCashInHandFromReconciliation,
} from "./cash.ts";
import { calculateLotteryCashAdvanceImpact } from "./cash-advance-calculation.ts";
import { getLotteryCashInHandPaidEftSweepDate } from "./cash-in-hand-cutoff.ts";

test("lottery cash in hand uses the full counted cash amount", () => {
  assert.equal(
    calculateLotteryCashInHandFromReconciliation({
      posRegisterTotal: 1094.07,
    }),
    1094.07,
  );
});

test("lottery cash in hand keeps the physical count as entered", () => {
  assert.equal(
    calculateLotteryCashInHandFromReconciliation({
      posRegisterTotal: 130,
    }),
    130,
  );
});

test("lottery expected cash in hand uses the full expected cash amount", () => {
  assert.equal(
    calculateLotteryExpectedCashInHandFromReconciliation({
      totalExpectedCash: 851,
    }),
    851,
  );
});

test("lottery expected cash keeps the expected count as entered", () => {
  assert.equal(
    calculateLotteryExpectedCashInHandFromReconciliation({
      totalExpectedCash: 130,
    }),
    130,
  );
});

test("lottery scratch sales include only EOD audit revenue", () => {
  assert.equal(
    calculateLotteryEodScratchSales([
      { audit_type: "shift", calculated_revenue: 40 },
      { audit_type: "eod", calculated_revenue: 125.12 },
      { audit_type: "bin_load_retirement", calculated_revenue: 75 },
      { audit_type: "eod", calculated_revenue: "24.88" },
    ]),
    150,
  );
});

test("lottery cash movement scratch sales include sold-out and bin retirement revenue", () => {
  assert.equal(
    calculateLotteryCashMovementScratchSales([
      { audit_type: "shift", calculated_revenue: 40 },
      { audit_type: "eod", calculated_revenue: 125.12 },
      { audit_type: "bin_load_retirement", calculated_revenue: 75 },
      { audit_type: "eft_settlement_reversal", calculated_revenue: 20 },
      { audit_type: "opening", calculated_revenue: 100 },
      { audit_type: "eod", calculated_revenue: "24.88" },
    ]),
    265,
  );
});

test("lottery EOD expected cash uses lottery sales and deductions without float by default", () => {
  assert.equal(
    calculateLotteryEodExpectedCash({
      cashingBonus: 5,
      onlineTotalPayout: 40,
      scratchCardTotalPayout: 30,
      scratchSalesTotal: 150,
      terminalSales: 225,
      ticketCancels: 12.5,
    }),
    287.5,
  );
});

test("lottery EOD expected cash includes opening float", () => {
  assert.equal(
    calculateLotteryEodExpectedCash({
      cashingBonus: 5,
      onlineTotalPayout: 40,
      openingCashFloat: 125,
      scratchCardTotalPayout: 30,
      scratchSalesTotal: 150,
      terminalSales: 225,
      ticketCancels: 12.5,
    }),
    412.5,
  );
});

test("lottery cash stats movement allows payout-heavy days to reduce the balance", () => {
  assert.equal(
    calculateLotteryCashStatsMovement({
      cashingBonus: 2,
      onlineTotalPayout: 150,
      scratchCardTotalPayout: 75,
      scratchSalesTotal: 80,
      terminalSales: 25,
      ticketCancels: 4.5,
    }),
    -126.5,
  );
});

test("lottery EOD expected cash does not go below zero", () => {
  assert.equal(
    calculateLotteryEodExpectedCash({
      onlineTotalPayout: 500,
      scratchSalesTotal: 20,
      terminalSales: 25,
    }),
    0,
  );
});

test("lottery cash in hand applies cash advance impact after reconciliation", () => {
  assert.equal(
    applyLotteryCashAdvanceImpact({
      cashAdvanceImpact: -22.75,
      cashInHand: calculateLotteryCashInHandFromReconciliation({
        posRegisterTotal: 632.82,
      }),
    }),
    610.07,
  );
});

test("lottery cash in hand applies short-over impact after daily collection", () => {
  assert.equal(
    applyLotteryCashShortOverImpact({
      cashInHand: 632.82,
      shortOverAmount: 22.75,
    }),
    610.07,
  );

  assert.equal(
    applyLotteryCashShortOverImpact({
      cashInHand: 632.82,
      shortOverAmount: -12.25,
    }),
    645.07,
  );
});

test("lottery cash in hand includes today's payable EFT sweep", () => {
  assert.equal(
    getLotteryCashInHandPaidEftSweepDate({
      businessDate: "2026-06-11",
      cashInHandCutoffDate: "2026-06-10",
    }),
    "2026-06-11",
  );

  assert.equal(
    getLotteryCashInHandPaidEftSweepDate({
      businessDate: "2026-06-10",
      cashInHandCutoffDate: "2026-06-09",
    }),
    "2026-06-04",
  );
});

test("lottery cash advance impact subtracts advances and adds paybacks", () => {
  assert.equal(
    calculateLotteryCashAdvanceImpact({
      advancesTaken: 125,
      paybacksReceived: 40,
    }),
    -85,
  );

  assert.equal(
    calculateLotteryCashAdvanceImpact({
      advancesTaken: 10.111,
      paybacksReceived: 25.225,
    }),
    15.11,
  );
});
