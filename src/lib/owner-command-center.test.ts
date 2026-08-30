import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRowsThroughOwnerReportingPeriod,
  filterRowsToOwnerReportingPeriod,
  getMissingOwnerLotteryReconciliationDays,
  getMissingOwnerReconciliationDateKeys,
  getOwnerReportingPeriod,
  resolveOwnerReportingMonth,
  sumRowsInOwnerReportingPeriod,
} from "./owner-command-center.ts";

test("resolveOwnerReportingMonth accepts a valid current or past month", () => {
  assert.equal(resolveOwnerReportingMonth("2026-02", "2026-08-29"), "2026-02");
  assert.equal(
    resolveOwnerReportingMonth(["2026-07", "2026-06"], "2026-08-29"),
    "2026-07",
  );
});

test("resolveOwnerReportingMonth falls back for invalid and future months", () => {
  assert.equal(resolveOwnerReportingMonth(undefined, "2026-08-29"), "2026-08");
  assert.equal(resolveOwnerReportingMonth("2026-13", "2026-08-29"), "2026-08");
  assert.equal(resolveOwnerReportingMonth("2026-09", "2026-08-29"), "2026-08");
});

test("getOwnerReportingPeriod covers the complete selected calendar month", () => {
  assert.deepEqual(getOwnerReportingPeriod("2024-02"), {
    endDateKey: "2024-02-29",
    monthKey: "2024-02",
    startDateKey: "2024-02-01",
  });
});

test("selected-month filters include both boundaries and exclude adjacent months", () => {
  const period = getOwnerReportingPeriod("2026-04");
  const rows = [
    { date: new Date("2026-03-31T12:00:00.000Z"), id: "before" },
    { date: new Date("2026-04-01T12:00:00.000Z"), id: "start" },
    { date: new Date("2026-04-30T12:00:00.000Z"), id: "end" },
    { date: new Date("2026-05-01T12:00:00.000Z"), id: "after" },
  ];

  assert.deepEqual(
    filterRowsToOwnerReportingPeriod(rows, (row) => row.date, period).map(
      (row) => row.id,
    ),
    ["start", "end"],
  );
  assert.equal(
    sumRowsInOwnerReportingPeriod(
      rows.map((row, index) => ({ ...row, amount: index + 1 })),
      (row) => row.date,
      (row) => row.amount,
      period,
    ),
    5,
  );
});

test("period-end filtering supports historical cash-on-hand balances", () => {
  const period = getOwnerReportingPeriod("2026-04");
  const rows = [
    { amount: 100, date: "2026-03-31" },
    { amount: -20, date: "2026-04-30" },
    { amount: -30, date: "2026-05-01" },
  ];

  assert.deepEqual(
    filterRowsThroughOwnerReportingPeriod(rows, (row) => row.date, period),
    rows.slice(0, 2),
  );
});

test("missing reconciliation dates cover every unclosed day in a historical month", () => {
  const period = getOwnerReportingPeriod("2026-04");
  const reconciledDates = Array.from({ length: 30 }, (_, index) =>
    String(index + 1).padStart(2, "0"),
  )
    .filter((day) => !["01", "15", "30"].includes(day))
    .map((day) => `2026-04-${day}`);

  assert.deepEqual(
    getMissingOwnerReconciliationDateKeys(
      reconciledDates,
      period,
      "2026-08-29",
    ),
    ["2026-04-30", "2026-04-15", "2026-04-01"],
  );
});

test("missing reconciliation dates stop at today for the current month", () => {
  const period = getOwnerReportingPeriod("2026-08");

  assert.deepEqual(
    getMissingOwnerReconciliationDateKeys(
      [
        new Date("2026-08-01T12:00:00.000Z"),
        "2026-08-03",
        "2026-08-03",
        "2026-09-01",
      ],
      period,
      "2026-08-03",
    ),
    ["2026-08-02"],
  );
});

test("missing lottery reconciliation days identify incomplete EOD activity", () => {
  const period = getOwnerReportingPeriod("2026-08");

  assert.deepEqual(
    getMissingOwnerLotteryReconciliationDays(
      ["2026-08-02", "2026-08-04"],
      ["2026-08-01"],
      period,
      "2026-08-03",
    ),
    [
      { dateKey: "2026-08-03", hasActivity: false },
      { dateKey: "2026-08-02", hasActivity: true },
    ],
  );
});

export {};
