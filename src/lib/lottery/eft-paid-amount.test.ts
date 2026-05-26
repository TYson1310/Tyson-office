import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAppliedLotteryEftPayment,
  normalizeOptionalLotteryEftPaidAmount,
} from "./eft-paid-amount.ts";

test("calculateAppliedLotteryEftPayment uses the actual paid amount when present", () => {
  assert.equal(
    calculateAppliedLotteryEftPayment({
      netEftDue: 278.92,
      paidAmount: 280,
    }),
    280,
  );
});

test("calculateAppliedLotteryEftPayment falls back to calculated net due", () => {
  assert.equal(
    calculateAppliedLotteryEftPayment({
      netEftDue: 278.92,
      paidAmount: null,
    }),
    278.92,
  );
});

test("normalizeOptionalLotteryEftPaidAmount keeps zero as an entered amount", () => {
  assert.equal(normalizeOptionalLotteryEftPaidAmount(0), 0);
});

export {};
