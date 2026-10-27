import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNrsReportDate,
  parseNrsCashTenderAmount,
  parseNrsInventoryStatusCsv,
  parseNrsSalesHistoryCsv,
} from "./nrs-email-import.ts";

test("parses NRS sales history rows and preserves UPC-less department rows", () => {
  const rows = parseNrsSalesHistoryCsv(
    [
      "UPC,Name,Total Qty,Total Amount",
      '0123,"Bottled Water",2,4.50',
      ',"Cigarettes",1,12.00',
    ].join("\n"),
  );

  assert.deepEqual(rows, [
    { upc: "0123", name: "Bottled Water", totalQty: 2, totalAmount: 4.5 },
    { upc: null, name: "Cigarettes", totalQty: 1, totalAmount: 12 },
  ]);
});

test("parses the inventory report after its Reorder Now preamble", () => {
  const rows = parseNrsInventoryStatusCsv(
    [
      '"Reorder Now"',
      "UPC,Name,Department,In Stock,Predicted Days,Count Threshold,Days Threshold",
      '0123,"Bottled Water",Drinks,4,,10,7',
    ].join("\n"),
  );

  assert.deepEqual(rows, [
    {
      upc: "0123",
      name: "Bottled Water",
      department: "Drinks",
      inStock: 4,
      predictedDays: null,
      countThreshold: 10,
      daysThreshold: 7,
    },
  ]);
});

test("extracts the report date from NRS filenames", () => {
  assert.equal(
    extractNrsReportDate("Sales_History_Sep_14,_2026.csv"),
    "2026-09-14",
  );
});

test("reads the NRS cash-tender amount without manual entry", () => {
  assert.equal(
    parseNrsCashTenderAmount(
      ["Total Sales,Cash Tender,Card Tender", "878.51,810.90,67.61"].join("\n"),
    ),
    810.9,
  );
});
