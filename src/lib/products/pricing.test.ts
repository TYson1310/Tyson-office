import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateSellingPriceForMargin,
  calculateUnitAmountForPackSizeChange,
  normalizeNonNegativeCurrency,
  normalizePositivePackSize,
} from "./pricing.ts";

test("calculateUnitAmountForPackSizeChange preserves pack totals", () => {
  assert.equal(calculateUnitAmountForPackSizeChange(40, 1, 10), 4);
  assert.equal(calculateUnitAmountForPackSizeChange("4.00", 10, 5), 8);
  assert.equal(calculateUnitAmountForPackSizeChange(2.99, 12, 24), 1.5);
});

test("calculateUnitAmountForPackSizeChange rejects invalid inputs", () => {
  assert.equal(calculateUnitAmountForPackSizeChange(-1, 1, 10), null);
  assert.equal(calculateUnitAmountForPackSizeChange(40, 0, 10), null);
  assert.equal(calculateUnitAmountForPackSizeChange(40, 1, 0), null);
  assert.equal(calculateUnitAmountForPackSizeChange(40, 1.5, 10), null);
});

test("product pricing normalizers accept stored numeric strings", () => {
  assert.equal(normalizeNonNegativeCurrency("3.335"), 3.34);
  assert.equal(normalizePositivePackSize("12"), 12);
});

test("calculateSellingPriceForMargin derives price from cost and margin", () => {
  assert.equal(calculateSellingPriceForMargin(6, 40), 10);
  assert.equal(calculateSellingPriceForMargin("1.20", "40"), 2);
  assert.equal(calculateSellingPriceForMargin(2.99, 25), 3.99);
  assert.equal(calculateSellingPriceForMargin(6, 95), 120);
});

test("calculateSellingPriceForMargin rejects invalid margins", () => {
  assert.equal(calculateSellingPriceForMargin(6, -1), null);
  assert.equal(calculateSellingPriceForMargin(6, 95.1), null);
  assert.equal(calculateSellingPriceForMargin(0, 40), null);
});
