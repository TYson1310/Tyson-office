import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLotteryCashInHandFromReconciliation,
  calculateLotteryExpectedCashInHandFromReconciliation,
} from "./cash.ts";

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
