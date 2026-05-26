import test from "node:test";
import assert from "node:assert/strict";
import {
  isPostedVendorPaymentStatus,
  normalizeVendorPaymentStatus,
} from "./payments.ts";

test("normalizeVendorPaymentStatus defaults to posted", () => {
  assert.equal(normalizeVendorPaymentStatus(undefined), "posted");
  assert.equal(normalizeVendorPaymentStatus("posted"), "posted");
  assert.equal(normalizeVendorPaymentStatus("void"), "void");
});

test("isPostedVendorPaymentStatus only accepts posted payments", () => {
  assert.equal(isPostedVendorPaymentStatus("posted"), true);
  assert.equal(isPostedVendorPaymentStatus("void"), false);
});
