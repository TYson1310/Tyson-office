import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateVendorInvoiceNetBalance,
  deriveVendorInvoiceStatus,
} from "./accounting-core.ts";

test("calculateVendorInvoiceNetBalance subtracts payments and adjustments", () => {
  assert.equal(
    calculateVendorInvoiceNetBalance({
      invoiceAmount: 250.55,
      totalPayments: 100.2,
      totalAdjustments: 25.1,
    }),
    125.25,
  );
});

test("deriveVendorInvoiceStatus marks fully settled invoices as paid", () => {
  assert.equal(
    deriveVendorInvoiceStatus({
      dueDate: "2099-12-31",
      netBalance: 0,
    }),
    "paid",
  );
});

test("deriveVendorInvoiceStatus marks past-due balances as overdue", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  assert.equal(
    deriveVendorInvoiceStatus({
      dueDate: yesterday.toISOString().slice(0, 10),
      netBalance: 10,
    }),
    "overdue",
  );
});

test("deriveVendorInvoiceStatus keeps future balances pending", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  assert.equal(
    deriveVendorInvoiceStatus({
      dueDate: tomorrow.toISOString().slice(0, 10),
      netBalance: 10,
    }),
    "pending",
  );
});

export {};
