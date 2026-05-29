import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLotteryCashInHandFromReconciliation,
  calculateLotteryExpectedCashInHandFromReconciliation,
} from "./cash.ts";
import { calculateLotteryCashAdvanceImpact } from "./cash-advance-calculation.ts";

test("lottery cash in hand excludes the starting float", () => {
  assert.equal(
    calculateLotteryCashInHandFromReconciliation({
      openingCashFloat: 443.07,
      posRegisterTotal: 1094.07,
    }),
    651,
  );
});

test("lottery expected cash in hand excludes the starting float", () => {
  assert.equal(
    calculateLotteryExpectedCashInHandFromReconciliation({
      openingCashFloat: 200,
      totalExpectedCash: 851,
    }),
    651,
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
