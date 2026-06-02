import type { PaymentTerms } from "@/types/erp.types";
import type {
  InvoiceItem,
  InvoiceVerificationPayload,
  ProcessedInvoiceData,
} from "@/types/types";

export const MAX_INVOICE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const INVOICE_UPLOAD_ACCEPT = ".pdf,image/png,image/jpeg,image/webp";
export const INVOICE_COST_INCREASE_WARNING_PERCENT = 5;

const ALLOWED_INVOICE_FILE_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
]);

export const ALLOWED_INVOICE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type VendorInvoiceSupplierOption = {
  id: string;
  name: string;
  paymentTerms?: PaymentTerms | null;
};

export type VendorInvoiceProductOption = {
  id: string;
  supplierId: string;
  name: string;
  description?: string | null;
  sku: string;
  barcode?: string | null;
  cost?: number;
  lastReceiptCost?: number | null;
  lastReceiptDate?: string | null;
  lastReceiptInvoiceNumber?: string | null;
};

export type InvoiceTotalsReconciliation = {
  lineItemsTotal: number;
  subtotal: number;
  tax: number;
  total: number;
  expectedTotalFromSubtotal: number;
  hasLineItemsSubtotalMismatch: boolean;
  hasSubtotalTaxTotalMismatch: boolean;
  hasMismatch: boolean;
};

export type InvoiceItemCostReview = {
  productId: string;
  productName: string;
  productSku: string;
  baselineLabel: "last invoice" | "current product cost";
  previousCost: number;
  newCost: number;
  increaseAmount: number;
  increasePercent: number;
  hasIncrease: boolean;
  lastReceiptDate?: string | null;
  lastReceiptInvoiceNumber?: string | null;
};

const INVOICE_TOTAL_RECONCILIATION_TOLERANCE = 0.05;

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalizeNameKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeSkuSegment(value: string, maxLength: number) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return "ITEM";
  }

  return normalized.slice(0, maxLength).replace(/-+$/g, "") || "ITEM";
}

function hashInvoiceKey(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36).toUpperCase();
}

function formatAmountLine(label: string, amount: unknown, currency: unknown) {
  const normalizedAmount = normalizeInvoiceAmount(amount);

  if (normalizedAmount <= 0) {
    return null;
  }

  return `${label}: ${normalizedAmount.toFixed(2)} ${normalizeInvoiceCurrency(currency)}`;
}

export function normalizeInvoiceText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

export function normalizeOptionalInvoiceText(value: unknown) {
  const normalized = normalizeInvoiceText(value);
  return normalized.length > 0 ? normalized : null;
}

export function normalizeInvoiceItemCode(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return normalizeInvoiceText(value).toUpperCase().replace(/\s+/g, "");
}

export function normalizeInvoiceBarcode(value: unknown) {
  const normalized = normalizeInvoiceText(value);

  if (!normalized) {
    return "";
  }

  const digits = normalized.replace(/\D/g, "");

  return digits.length >= 8 && digits.length <= 14 ? digits : "";
}

export function normalizeInvoiceAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundCurrency(value);
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);

    if (Number.isFinite(parsed)) {
      return roundCurrency(parsed);
    }
  }

  return 0;
}

export function normalizeInvoiceCurrency(value: unknown) {
  const normalized = normalizeInvoiceText(value).toUpperCase();
  return normalized || "USD";
}

export function normalizeInvoicePieceCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return roundQuantity(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());

    if (Number.isFinite(parsed) && parsed > 0) {
      return roundQuantity(parsed);
    }
  }

  return 0;
}

export function toIsoInvoiceDate(value: unknown) {
  const normalized = normalizeInvoiceText(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function normalizeInvoiceItems(value: unknown): InvoiceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: InvoiceItem[] = [];

  value.forEach((item) => {
    const record =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : {};
    const description = normalizeInvoiceText(record.description);
    const itemCode = normalizeInvoiceItemCode(
      record.itemCode ?? record.item_code ?? record.upc ?? record.barcode,
    );

    if (!description) {
      return;
    }

    items.push({
      itemCode: itemCode || undefined,
      description,
      quantity: normalizeInvoiceAmount(record.quantity),
      unitPrice: normalizeInvoiceAmount(record.unitPrice ?? record.unit_price),
      amount: normalizeInvoiceAmount(
        record.amount ?? record.lineTotal ?? record.line_total,
      ),
      itemsPerPack:
        normalizeInvoicePieceCount(
          record.itemsPerPack ?? record.items_per_pack,
        ) || undefined,
      matchedProductId:
        normalizeInvoiceText(record.matchedProductId) || undefined,
    });
  });

  return items;
}

export function buildInvoiceDescription(
  items: InvoiceItem[],
  fallback?: unknown,
) {
  const explicitDescription = normalizeOptionalInvoiceText(fallback);

  if (explicitDescription) {
    return explicitDescription;
  }

  const descriptions = items
    .map((item) => item.description)
    .filter(Boolean)
    .slice(0, 3);

  if (descriptions.length === 0) {
    return null;
  }

  const summary = descriptions.join(", ");
  return items.length > 3 ? `${summary}, +${items.length - 3} more` : summary;
}

export function reconcileInvoiceTotals(
  payload: Pick<
    Partial<InvoiceVerificationPayload>,
    "items" | "subtotal" | "tax" | "total"
  >,
): InvoiceTotalsReconciliation {
  const items = normalizeInvoiceItems(payload.items);
  const lineItemsTotal = roundCurrency(
    items.reduce((sum, item) => sum + normalizeInvoiceAmount(item.amount), 0),
  );
  const subtotal = normalizeInvoiceAmount(payload.subtotal);
  const tax = normalizeInvoiceAmount(payload.tax);
  const total = normalizeInvoiceAmount(payload.total);
  const expectedTotalFromSubtotal = roundCurrency(subtotal + tax);
  const hasLineItemsSubtotalMismatch =
    items.length > 0 &&
    subtotal > 0 &&
    Math.abs(lineItemsTotal - subtotal) >
      INVOICE_TOTAL_RECONCILIATION_TOLERANCE;
  const hasSubtotalTaxTotalMismatch =
    total > 0 &&
    (subtotal > 0 || tax > 0) &&
    Math.abs(expectedTotalFromSubtotal - total) >
      INVOICE_TOTAL_RECONCILIATION_TOLERANCE;

  return {
    lineItemsTotal,
    subtotal,
    tax,
    total,
    expectedTotalFromSubtotal,
    hasLineItemsSubtotalMismatch,
    hasSubtotalTaxTotalMismatch,
    hasMismatch: hasLineItemsSubtotalMismatch || hasSubtotalTaxTotalMismatch,
  };
}

export function calculateInvoiceItemUnitCount(item: Partial<InvoiceItem>) {
  const quantity = normalizeInvoicePieceCount(item.quantity);
  const itemsPerPack = normalizeInvoicePieceCount(item.itemsPerPack);

  if (quantity <= 0 || itemsPerPack <= 0) {
    return 0;
  }

  return roundQuantity(quantity * itemsPerPack);
}

export function calculateInvoiceItemCostPerPiece(item: Partial<InvoiceItem>) {
  const amount = normalizeInvoiceAmount(item.amount);
  const unitCount = calculateInvoiceItemUnitCount(item);

  if (amount <= 0 || unitCount <= 0) {
    return 0;
  }

  return roundCurrency(amount / unitCount);
}

export function buildInvoiceItemCostReview(
  item: Partial<InvoiceItem>,
  product?: VendorInvoiceProductOption | null,
  options?: { increasePercentThreshold?: number },
): InvoiceItemCostReview | null {
  if (!product) {
    return null;
  }

  const newCost = calculateInvoiceItemCostPerPiece(item);

  if (newCost <= 0) {
    return null;
  }

  const lastReceiptCost = normalizeInvoiceAmount(product.lastReceiptCost);
  const currentProductCost = normalizeInvoiceAmount(product.cost);
  const previousCost =
    lastReceiptCost > 0 ? lastReceiptCost : currentProductCost;
  const baselineLabel =
    lastReceiptCost > 0
      ? ("last invoice" as const)
      : ("current product cost" as const);

  if (previousCost <= 0) {
    return null;
  }

  const increaseAmount = roundCurrency(newCost - previousCost);
  const increasePercent = roundCurrency((increaseAmount / previousCost) * 100);
  const threshold =
    options?.increasePercentThreshold ?? INVOICE_COST_INCREASE_WARNING_PERCENT;

  return {
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    baselineLabel,
    previousCost,
    newCost,
    increaseAmount,
    increasePercent,
    hasIncrease: increaseAmount > 0 && increasePercent >= threshold,
    lastReceiptDate: product.lastReceiptDate,
    lastReceiptInvoiceNumber: product.lastReceiptInvoiceNumber,
  };
}

export function buildInvoiceProductMatchKey(value: unknown) {
  return normalizeNameKey(normalizeInvoiceText(value));
}

export function calculateInvoiceItemInventoryQuantity(
  item: Partial<InvoiceItem>,
) {
  const unitCount = calculateInvoiceItemUnitCount(item);

  if (unitCount > 0) {
    return unitCount;
  }

  return normalizeInvoicePieceCount(item.quantity);
}

export function calculateInvoiceItemCatalogCost(item: Partial<InvoiceItem>) {
  const amount = normalizeInvoiceAmount(item.amount);
  const inventoryQuantity = calculateInvoiceItemInventoryQuantity(item);

  if (amount > 0 && inventoryQuantity > 0) {
    return roundCurrency(amount / inventoryQuantity);
  }

  const unitPrice = normalizeInvoiceAmount(item.unitPrice);

  if (unitPrice > 0) {
    const itemsPerPack = normalizeInvoicePieceCount(item.itemsPerPack);

    if (itemsPerPack > 0) {
      return roundCurrency(unitPrice / itemsPerPack);
    }

    return unitPrice;
  }

  return amount > 0 ? amount : 0;
}

export function buildInvoiceProductSku(
  supplierId: string,
  itemDescription: string,
) {
  const supplierSegment = normalizeSkuSegment(supplierId.replace(/-/g, ""), 6);
  const descriptionText = normalizeInvoiceText(itemDescription);
  const descriptionSegment = normalizeSkuSegment(descriptionText, 18);
  const key = buildInvoiceProductMatchKey(descriptionText) || "item";
  const hash = hashInvoiceKey(`${supplierId}:${key}`).slice(0, 6) || "000000";

  return `INV-${supplierSegment}-${descriptionSegment}-${hash}`;
}

export function sanitizeProcessedInvoice(
  value: unknown,
): Partial<ProcessedInvoiceData> {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const vendor =
    typeof record.vendor === "object" && record.vendor !== null
      ? (record.vendor as Record<string, unknown>)
      : {};
  const customer =
    typeof record.customer === "object" && record.customer !== null
      ? (record.customer as Record<string, unknown>)
      : {};
  const invoice =
    typeof record.invoice === "object" && record.invoice !== null
      ? (record.invoice as Record<string, unknown>)
      : {};
  const items = normalizeInvoiceItems(record.items);

  return {
    invoiceNumber: normalizeInvoiceText(
      record.invoiceNumber ?? invoice.invoice_number,
    ),
    issueDate:
      toIsoInvoiceDate(
        record.issueDate ?? record.date ?? invoice.invoice_date,
      ) ?? "",
    dueDate: toIsoInvoiceDate(record.dueDate ?? invoice.due_date) ?? "",
    vendorName: normalizeInvoiceText(record.vendorName ?? vendor.name),
    vendorAddress:
      normalizeOptionalInvoiceText(record.vendorAddress ?? vendor.address) ??
      undefined,
    vendorPhone:
      normalizeOptionalInvoiceText(record.vendorPhone ?? vendor.phone) ??
      undefined,
    vendorEmail:
      normalizeOptionalInvoiceText(record.vendorEmail ?? vendor.email) ??
      undefined,
    customerName:
      normalizeOptionalInvoiceText(record.customerName ?? customer.name) ??
      undefined,
    customerNumber:
      normalizeOptionalInvoiceText(
        record.customerNumber ?? customer.customer_number,
      ) ?? undefined,
    customerPhone:
      normalizeOptionalInvoiceText(record.customerPhone ?? customer.phone) ??
      undefined,
    customerAddress:
      normalizeOptionalInvoiceText(
        record.customerAddress ?? customer.address,
      ) ?? undefined,
    items,
    subtotal: normalizeInvoiceAmount(record.subtotal ?? invoice.subtotal),
    tax: normalizeInvoiceAmount(record.tax ?? invoice.tax_total),
    discountTotal: normalizeInvoiceAmount(
      record.discountTotal ?? invoice.discount_total,
    ),
    total: normalizeInvoiceAmount(record.total ?? invoice.final_total),
    arBalance: normalizeInvoiceAmount(record.arBalance ?? invoice.ar_balance),
    currency: normalizeInvoiceCurrency(record.currency ?? invoice.currency),
    description:
      buildInvoiceDescription(items, record.description) ?? undefined,
  };
}

export function buildInvoiceNotes(
  payload: Partial<InvoiceVerificationPayload>,
) {
  const sections: string[] = [];
  const items = normalizeInvoiceItems(payload.items);
  const userNotes = normalizeOptionalInvoiceText(payload.notes);
  const metadataLines = [
    normalizeOptionalInvoiceText(payload.vendorName)
      ? `Extracted vendor: ${normalizeInvoiceText(payload.vendorName)}`
      : null,
    normalizeOptionalInvoiceText(payload.vendorAddress)
      ? `Vendor address: ${normalizeInvoiceText(payload.vendorAddress)}`
      : null,
    normalizeOptionalInvoiceText(payload.vendorPhone)
      ? `Vendor phone: ${normalizeInvoiceText(payload.vendorPhone)}`
      : null,
    normalizeOptionalInvoiceText(payload.vendorEmail)
      ? `Vendor email: ${normalizeInvoiceText(payload.vendorEmail)}`
      : null,
    normalizeOptionalInvoiceText(payload.customerName)
      ? `Customer: ${normalizeInvoiceText(payload.customerName)}`
      : null,
    normalizeOptionalInvoiceText(payload.customerNumber)
      ? `Customer number: ${normalizeInvoiceText(payload.customerNumber)}`
      : null,
    normalizeOptionalInvoiceText(payload.customerPhone)
      ? `Customer phone: ${normalizeInvoiceText(payload.customerPhone)}`
      : null,
    normalizeOptionalInvoiceText(payload.customerAddress)
      ? `Customer address: ${normalizeInvoiceText(payload.customerAddress)}`
      : null,
    formatAmountLine("Subtotal", payload.subtotal, payload.currency),
    formatAmountLine("Tax", payload.tax, payload.currency),
    formatAmountLine("Discount", payload.discountTotal, payload.currency),
    formatAmountLine("AR balance", payload.arBalance, payload.currency),
    items.length > 0
      ? `Items: ${items
          .map((item) => {
            const itemCode = normalizeInvoiceItemCode(item.itemCode);
            const quantity = normalizeInvoicePieceCount(item.quantity);
            const itemsPerPack = normalizeInvoicePieceCount(item.itemsPerPack);
            const costPerPiece = calculateInvoiceItemCostPerPiece(item);
            const itemCodeText = itemCode ? `code ${itemCode}` : null;
            const amountText =
              normalizeInvoiceAmount(item.amount) > 0
                ? `amount ${normalizeInvoiceAmount(item.amount).toFixed(2)}`
                : null;
            const quantityText = quantity > 0 ? `qty ${quantity}` : null;
            const packText = itemsPerPack > 0 ? `${itemsPerPack} / pack` : null;
            const perPieceText =
              costPerPiece > 0 ? `per item ${costPerPiece.toFixed(2)}` : null;
            const qualifiers = [
              itemCodeText,
              amountText,
              quantityText,
              packText,
              perPieceText,
            ]
              .filter((value): value is string => Boolean(value))
              .join(", ");

            return qualifiers.length > 0
              ? `${item.description} (${qualifiers})`
              : item.description;
          })
          .join(" | ")}`
      : null,
  ].filter((line): line is string => Boolean(line));

  if (userNotes) {
    sections.push(userNotes);
  }

  if (metadataLines.length > 0) {
    sections.push(`AI extraction details\n${metadataLines.join("\n")}`);
  }

  return sections.join("\n\n") || null;
}

export function calculateDueDateFromPaymentTerms(
  issueDate: string,
  paymentTerms?: PaymentTerms | null,
) {
  const normalizedIssueDate = toIsoInvoiceDate(issueDate);

  if (!normalizedIssueDate) {
    return "";
  }

  if (!paymentTerms || paymentTerms === "cod" || paymentTerms === "prepaid") {
    return normalizedIssueDate;
  }

  const dueDate = new Date(`${normalizedIssueDate}T00:00:00.000Z`);

  if (paymentTerms === "net60") {
    dueDate.setUTCDate(dueDate.getUTCDate() + 60);
  } else if (paymentTerms === "net90") {
    dueDate.setUTCDate(dueDate.getUTCDate() + 90);
  } else {
    dueDate.setUTCDate(dueDate.getUTCDate() + 30);
  }

  return dueDate.toISOString().slice(0, 10);
}

export function findSuggestedSupplierId(
  vendorName: string,
  suppliers: VendorInvoiceSupplierOption[],
) {
  const normalizedVendorName = normalizeNameKey(vendorName);

  if (!normalizedVendorName) {
    return "";
  }

  const exactMatch = suppliers.find(
    (supplier) => normalizeNameKey(supplier.name) === normalizedVendorName,
  );

  if (exactMatch) {
    return exactMatch.id;
  }

  const partialMatch = suppliers.find((supplier) => {
    const normalizedSupplierName = normalizeNameKey(supplier.name);

    return (
      normalizedSupplierName.includes(normalizedVendorName) ||
      normalizedVendorName.includes(normalizedSupplierName)
    );
  });

  return partialMatch?.id ?? "";
}

export function findSuggestedProductId(
  itemDescription: string,
  supplierId: string,
  products: VendorInvoiceProductOption[],
  itemCode?: string,
) {
  const normalizedItemCode = normalizeInvoiceItemCode(itemCode);
  const normalizedBarcode = normalizeInvoiceBarcode(itemCode);
  const normalizedDescription = buildInvoiceProductMatchKey(itemDescription);

  if (!supplierId) {
    return "";
  }

  if (normalizedBarcode) {
    const barcodeMatch = products.find(
      (product) =>
        product.supplierId === supplierId &&
        normalizeInvoiceBarcode(product.barcode) === normalizedBarcode,
    );

    if (barcodeMatch) {
      return barcodeMatch.id;
    }
  }

  if (normalizedItemCode) {
    const skuMatch = products.find(
      (product) =>
        product.supplierId === supplierId &&
        normalizeInvoiceItemCode(product.sku) === normalizedItemCode,
    );

    if (skuMatch) {
      return skuMatch.id;
    }
  }

  if (!normalizedDescription) {
    return "";
  }

  const exactMatches = products.filter((product) => {
    if (product.supplierId !== supplierId) {
      return false;
    }

    return (
      buildInvoiceProductMatchKey(product.name) === normalizedDescription ||
      buildInvoiceProductMatchKey(product.description ?? "") ===
        normalizedDescription
    );
  });

  return exactMatches.length === 1 ? exactMatches[0].id : "";
}

export function isAllowedInvoiceFile(
  fileName: string,
  mimeType?: string | null,
) {
  if (mimeType && ALLOWED_INVOICE_MIME_TYPES.has(mimeType)) {
    return true;
  }

  const extension = fileName.split(".").pop()?.toLowerCase();
  return Boolean(extension && ALLOWED_INVOICE_FILE_EXTENSIONS.has(extension));
}

export function sanitizeStorageFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!extension) {
    return baseName || "invoice";
  }

  return `${baseName || "invoice"}.${extension}`;
}
