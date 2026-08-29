import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeVendorAdjustmentStatus,
  summarizeVendorAdjustmentInventoryItems,
} from "./adjustments.ts";

test("normalizeVendorAdjustmentStatus defaults invalid values to draft", () => {
  assert.equal(normalizeVendorAdjustmentStatus("invalid"), "draft");
  assert.equal(normalizeVendorAdjustmentStatus("approved"), "approved");
});

test("summarizeVendorAdjustmentInventoryItems aggregates repeated product lines", () => {
  const summary = summarizeVendorAdjustmentInventoryItems([
    {
      productId: "prod-1",
      description: "Milk crate",
      quantity: 2,
      unitCost: 3,
      amount: 6,
    },
    {
      productId: "prod-1",
      description: "Milk crate",
      quantity: 1,
      unitCost: 3.5,
      amount: 3.5,
    },
    {
      productId: "prod-2",
      description: "Bread tray",
      quantity: 4,
      unitCost: 1.25,
      amount: 5,
    },
  ]);

  assert.deepEqual(summary.get("prod-1"), {
    quantity: 3,
    amount: 9.5,
    description: "Milk crate",
    unitCost: 3.17,
  });
  assert.deepEqual(summary.get("prod-2"), {
    quantity: 4,
    amount: 5,
    description: "Bread tray",
    unitCost: 1.25,
  });
});

export {};
