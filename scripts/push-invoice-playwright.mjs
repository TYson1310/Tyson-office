#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

function parseArgs(argv) {
  const args = {
    invoicePath: process.env.INVOICE_JSON_PATH || "",
    baseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
    email: process.env.APP_EMAIL || "",
    password: process.env.APP_PASSWORD || "",
    headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    dryRun: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (token === "--headed") {
      args.headless = false;
      continue;
    }

    if (token.startsWith("--invoice=")) {
      args.invoicePath = token.slice("--invoice=".length);
      continue;
    }

    if (token.startsWith("--base-url=")) {
      args.baseUrl = token.slice("--base-url=".length);
      continue;
    }

    if (token.startsWith("--email=")) {
      args.email = token.slice("--email=".length);
      continue;
    }

    if (token.startsWith("--password=")) {
      args.password = token.slice("--password=".length);
    }
  }

  return args;
}

function normalizeNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toIsoDate(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function formatOutOfStockItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "none";
  }

  return items
    .map((item) => {
      const description = String(item?.description || "Unknown item");
      const code = item?.item_code ? ` (${item.item_code})` : "";
      const expected = item?.expected_date
        ? `, expected ${item.expected_date}`
        : "";

      return `- ${description}${code}${expected}`;
    })
    .join("\n");
}

function mapInvoiceJsonToPayload(raw) {
  const totals = raw?.totals ?? {};
  const discounts = raw?.discounts ?? {};
  const discountBreakdown = Array.isArray(discounts.volume_discount_breakdown)
    ? discounts.volume_discount_breakdown
    : [];

  const lineItems = Array.isArray(raw?.line_items) ? raw.line_items : [];

  const mappedItems = lineItems.map((item) => {
    const quantity = normalizeNumber(item?.quantity, 0);
    const unitCost = normalizeNumber(item?.unit_cost, 0);
    const amount = normalizeNumber(item?.amount, quantity * unitCost);
    const itemsPerPack =
      item?.items_per_pack == null
        ? undefined
        : normalizeNumber(item.items_per_pack, 0);

    return {
      itemCode: item?.item_code ? String(item.item_code) : "",
      description: String(item?.description || ""),
      quantity,
      unitPrice: unitCost,
      amount,
      itemsPerPack: itemsPerPack && itemsPerPack > 0 ? itemsPerPack : undefined,
    };
  });

  const notesLines = [
    "Imported from Playwright automation.",
    "",
    `source_invoice_number: ${String(raw?.invoice_number || "")}`,
    `manifest_number: ${String(raw?.manifest_number || "")}`,
    `customer_number: ${String(raw?.customer_number || "")}`,
    `order_number: ${String(raw?.order_number || "")}`,
    `dr_number: ${String(raw?.dr_number || "")}`,
    `terms: ${String(raw?.terms || "")}`,
    `truck: ${String(raw?.truck || "")}`,
    `sales_tax_exempt_number: ${String(raw?.sales_tax_exempt_number || "")}`,
    `cigarette_license_number: ${String(raw?.cigarette_license_number || "")}`,
    "",
    "totals:",
    `- quantity: ${normalizeNumber(totals.quantity, 0)}`,
    `- cost: ${normalizeNumber(totals.cost, 0).toFixed(2)}`,
    `- allowance: ${normalizeNumber(totals.allowance, 0).toFixed(2)}`,
    `- net_cost: ${normalizeNumber(totals.net_cost, 0).toFixed(2)}`,
    `- retail_total: ${normalizeNumber(totals.retail_total, 0).toFixed(2)}`,
    `- excise_tax: ${normalizeNumber(totals.excise_tax, 0).toFixed(2)}`,
    `- total_promotion: ${normalizeNumber(totals.total_promotion, 0).toFixed(2)}`,
    `- pay_this_amount: ${normalizeNumber(totals.pay_this_amount, 0).toFixed(2)}`,
    "",
    "discounts:",
    `- volume_discount: ${normalizeNumber(discounts.volume_discount, 0).toFixed(2)}`,
    "- breakdown:",
    ...discountBreakdown.map(
      (part) =>
        `  - group ${String(part.group || "")} qty ${normalizeNumber(part.quantity, 0)} discount ${normalizeNumber(part.discount, 0).toFixed(2)}`,
    ),
    "",
    "out_of_stock_items:",
    formatOutOfStockItems(raw?.out_of_stock_items),
  ];

  const invoiceNumber = String(raw?.invoice_number || "").trim();
  const issueDate = toIsoDate(raw?.invoice_date);
  const dueDate = toIsoDate(raw?.payment_due_date);
  const vendorName = String(raw?.vendor?.name || "").trim();
  const vendorAddress = String(raw?.vendor?.address || "").trim();
  const customerName = String(raw?.bill_to?.name || raw?.bill_to?.company || "").trim();

  return {
    supplierId: "",
    invoiceNumber,
    issueDate,
    dueDate,
    vendorName,
    vendorAddress,
    customerName,
    items: mappedItems,
    subtotal: normalizeNumber(totals.cost, 0),
    tax: normalizeNumber(totals.excise_tax, 0),
    total: normalizeNumber(totals.pay_this_amount, 0),
    currency: "USD",
    description: `Resnick Distributors invoice ${invoiceNumber}`,
    notes: notesLines.join("\n").trim(),
  };
}

async function loginAndPushInvoice(options, payload) {
  const browser = await chromium.launch({ headless: options.headless });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${options.baseUrl}/auth/login`, { waitUntil: "domcontentloaded" });

    await page.getByLabel("Email Address").fill(options.email);
    await page.getByLabel("Password").fill(options.password);
    await page.getByRole("button", { name: "Sign In" }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
      timeout: 30_000,
    });

    const response = await page.request.post(
      `${options.baseUrl}/api/vendor-invoices`,
      {
        multipart: {
          entryMode: "manual",
          payload: JSON.stringify(payload),
        },
      },
    );

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = { error: "Unable to parse API response JSON" };
    }

    return {
      status: response.status(),
      ok: response.ok(),
      body,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv);

  if (!options.invoicePath) {
    throw new Error("INVOICE_JSON_PATH or --invoice=... is required.");
  }

  if (!options.email || !options.password) {
    throw new Error("APP_EMAIL and APP_PASSWORD are required.");
  }

  const absoluteInvoicePath = path.isAbsolute(options.invoicePath)
    ? options.invoicePath
    : path.resolve(process.cwd(), options.invoicePath);

  const rawContent = await fs.readFile(absoluteInvoicePath, "utf8");
  const invoiceJson = JSON.parse(rawContent);
  const payload = mapInvoiceJsonToPayload(invoiceJson);

  if (!payload.invoiceNumber || !payload.issueDate || payload.total <= 0) {
    throw new Error(
      "Mapped payload is invalid. invoice_number, invoice_date, and positive pay_this_amount are required.",
    );
  }

  if (options.dryRun) {
    console.log("[dry-run] mapped payload preview:");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `Pushing invoice ${payload.invoiceNumber} to ${options.baseUrl} using Playwright...`,
  );

  const result = await loginAndPushInvoice(options, payload);

  if (!result.ok) {
    const details =
      result.body && typeof result.body === "object"
        ? JSON.stringify(result.body)
        : String(result.body);
    throw new Error(`Invoice push failed (HTTP ${result.status}): ${details}`);
  }

  console.log("Invoice push succeeded:");
  console.log(JSON.stringify(result.body, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
