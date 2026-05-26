import assert from "node:assert/strict";
import test from "node:test";
import {
  getCurrentMonthStartIsoDateInTimeZone,
  getCurrentYearStartIsoDateInTimeZone,
  getTodayIsoDateInTimeZone,
  formatDateOnly,
} from "./date-time.ts";

test("formatDateOnly keeps stored date-only values on the same calendar day", () => {
  assert.equal(formatDateOnly("2026-05-06"), "May 06, 2026");
});

test("getTodayIsoDateInTimeZone follows the requested store timezone", () => {
  const referenceDate = new Date("2026-05-20T03:30:00.000Z");

  assert.equal(
    getTodayIsoDateInTimeZone("America/New_York", referenceDate),
    "2026-05-19",
  );
  assert.equal(getTodayIsoDateInTimeZone("UTC", referenceDate), "2026-05-20");
});

test("current period starts use the store timezone date", () => {
  const referenceDate = new Date("2026-01-01T04:30:00.000Z");

  assert.equal(
    getCurrentMonthStartIsoDateInTimeZone("America/Los_Angeles", referenceDate),
    "2025-12-01",
  );
  assert.equal(
    getCurrentYearStartIsoDateInTimeZone("America/Los_Angeles", referenceDate),
    "2025-01-01",
  );
});

export {};
