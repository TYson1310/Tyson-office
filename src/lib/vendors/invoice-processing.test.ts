import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceItemCostReview,
  findSuggestedProductId,
  normalizeInvoiceBarcode,
  normalizeInvoiceItems,
  sanitizeProcessedInvoice,
} from "./invoice-processing.ts";

test("sanitizeProcessedInvoice maps nested Gemini invoice extraction", () => {
  const invoice = sanitizeProcessedInvoice({
    vendor: {
      name: "ABC Wholesale",
      phone: "555-0100",
      email: "billing@example.com",
      address: "10 Market St",
    },
    customer: {
      name: "Store 12",
      customer_number: "C-100",
      phone: "555-0199",
      address: "1 Store Way",
    },
    invoice: {
      invoice_number: "INV-42",
      invoice_date: "2026-06-01",
      due_date: "2026-06-15",
      currency: "USD",
      subtotal: 100,
      tax_total: 8,
      discount_total: 5,
      final_total: 103,
      ar_balance: 103,
    },
    items: [
      {
        item_code: "000123456789",
        description: "Candy box",
        quantity: 2,
        unit_price: 25,
        line_total: 50,
      },
    ],
  });

  assert.equal(invoice.invoiceNumber, "INV-42");
  assert.equal(invoice.vendorName, "ABC Wholesale");
  assert.equal(invoice.vendorPhone, "555-0100");
  assert.equal(invoice.customerNumber, "C-100");
  assert.equal(invoice.tax, 8);
  assert.equal(invoice.discountTotal, 5);
  assert.equal(invoice.total, 103);
  assert.deepEqual(invoice.items?.[0], {
    itemCode: "000123456789",
    description: "Candy box",
    quantity: 2,
    unitPrice: 25,
    amount: 50,
    itemsPerPack: undefined,
    matchedProductId: undefined,
  });
});

test("normalizeInvoiceItems preserves extracted item code aliases", () => {
  assert.deepEqual(
    normalizeInvoiceItems([
      {
        barcode: "  upc 123  ",
        description: "Water case",
        quantity: "3",
        unit_price: "4.50",
        line_total: "$13.50",
      },
    ]),
    [
      {
        itemCode: "UPC123",
        description: "Water case",
        quantity: 3,
        unitPrice: 4.5,
        amount: 13.5,
        itemsPerPack: undefined,
        matchedProductId: undefined,
      },
    ],
  );
});

test("normalizeInvoiceBarcode keeps real UPC-like codes only", () => {
  assert.equal(normalizeInvoiceBarcode("UPC 0 123456 78905"), "012345678905");
  assert.equal(normalizeInvoiceBarcode("RD-12345"), "");
});

test("findSuggestedProductId prefers item code barcode matches", () => {
  assert.equal(
    findSuggestedProductId(
      "Different description",
      "supplier-1",
      [
        {
          id: "product-1",
          supplierId: "supplier-1",
          name: "Candy box",
          sku: "INV-CANDY-BOX",
          barcode: "000123456789",
        },
      ],
      "000123456789",
    ),
    "product-1",
  );
});

test("findSuggestedProductId prefers item code SKU matches", () => {
  assert.equal(
    findSuggestedProductId(
      "Different description",
      "supplier-1",
      [
        {
          id: "product-1",
          supplierId: "supplier-1",
          name: "Candy box",
          sku: "000123456789",
        },
      ],
      "000123456789",
    ),
    "product-1",
  );
});

test("buildInvoiceItemCostReview warns on real receipt cost increases", () => {
  const review = buildInvoiceItemCostReview(
    {
      description: "Candy box",
      quantity: 2,
      itemsPerPack: 10,
      amount: 30,
    },
    {
      id: "product-1",
      supplierId: "supplier-1",
      name: "Candy box",
      sku: "000123456789",
      cost: 1.2,
      lastReceiptCost: 1,
      lastReceiptDate: "2026-05-25",
      lastReceiptInvoiceNumber: "INV-25",
    },
  );

  assert.equal(review?.hasIncrease, true);
  assert.equal(review?.baselineLabel, "last invoice");
  assert.equal(review?.previousCost, 1);
  assert.equal(review?.newCost, 1.5);
  assert.equal(review?.increaseAmount, 0.5);
  assert.equal(review?.increasePercent, 50);
});

test("buildInvoiceItemCostReview ignores increases below threshold", () => {
  const review = buildInvoiceItemCostReview(
    {
      description: "Candy box",
      quantity: 1,
      itemsPerPack: 10,
      amount: 10.3,
    },
    {
      id: "product-1",
      supplierId: "supplier-1",
      name: "Candy box",
      sku: "000123456789",
      cost: 1,
      lastReceiptCost: 1,
    },
  );

  assert.equal(review?.hasIncrease, false);
  assert.equal(review?.increasePercent, 3);
});

test("buildInvoiceItemCostReview falls back to current product cost", () => {
  const review = buildInvoiceItemCostReview(
    {
      description: "Candy box",
      quantity: 1,
      itemsPerPack: 10,
      amount: 20,
    },
    {
      id: "product-1",
      supplierId: "supplier-1",
      name: "Candy box",
      sku: "000123456789",
      cost: 1.5,
    },
  );

  assert.equal(review?.baselineLabel, "current product cost");
  assert.equal(review?.hasIncrease, true);
  assert.equal(review?.previousCost, 1.5);
  assert.equal(review?.newCost, 2);
});

export {};
