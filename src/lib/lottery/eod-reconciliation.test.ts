import assert from "node:assert/strict";
import test from "node:test";
import { buildLotteryEodReconciliationUpsertPayload } from "./eod-reconciliation-payload.ts";

test("lottery EOD reconciliation payload stores signed short-over values", () => {
  assert.deepEqual(
    buildLotteryEodReconciliationUpsertPayload({
      closingCashFloat: 1050.5,
      createdBy: "user-42",
      discrepancyStatus: "over",
      managerNotes: "check drawer",
      openingCashFloat: 100,
      reportDate: "2026-06-04",
      shortOverAmount: -40.25,
      storeKey: "store-9",
      tillCash: 485.75,
      totalExpectedCash: 445.5,
    }),
    {
      closing_cash_float: 1050.5,
      created_by: "user-42",
      discrepancy_status: "over",
      manager_notes: "check drawer",
      opening_cash_float: 100,
      pos_register_total: 485.75,
      report_date: "2026-06-04",
      short_over_amount: -40.25,
      store_key: "store-9",
      total_expected_cash: 445.5,
    },
  );
});
