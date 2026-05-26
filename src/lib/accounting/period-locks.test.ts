import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountingLockMessage,
  isAccountingPeriodClosed,
} from "./period-locks.ts";

test("isAccountingPeriodClosed compares against the close-through date", () => {
  const lock = {
    closeThrough: "2026-03-31",
    note: "March close complete",
  };

  assert.equal(isAccountingPeriodClosed(lock, "2026-03-15"), true);
  assert.equal(isAccountingPeriodClosed(lock, "2026-03-31"), true);
  assert.equal(isAccountingPeriodClosed(lock, "2026-04-01"), false);
});

test("buildAccountingLockMessage includes the note when present", () => {
  const message = buildAccountingLockMessage(
    {
      closeThrough: "2026-03-31",
      note: "March close complete",
    },
    "Invoice INV-1001",
  );

  assert.match(message, /Invoice INV-1001/);
  assert.match(message, /March close complete/);
});
