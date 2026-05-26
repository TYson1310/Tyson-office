import type {
  VendorAdjustmentItem,
  VendorAdjustmentStatus,
  VendorAdjustmentType,
} from "../../types/erp.types";

export const VENDOR_ADJUSTMENT_TYPES: VendorAdjustmentType[] = [
  "return",
  "credit_note",
  "shortage",
  "damage",
  "rebate",
  "other",
];

export const VENDOR_ADJUSTMENT_TYPE_LABELS: Record<
  VendorAdjustmentType,
  string
> = {
  return: "Return to Supplier",
  credit_note: "Credit Note",
  shortage: "Shortage",
  damage: "Damaged Goods",
  rebate: "Rebate",
  other: "Other Deduction",
};

export const VENDOR_ADJUSTMENT_STATUSES: VendorAdjustmentStatus[] = [
  "draft",
  "approved",
  "void",
];

export const VENDOR_ADJUSTMENT_STATUS_LABELS: Record<
  VendorAdjustmentStatus,
  string
> = {
  draft: "Draft",
  approved: "Approved",
  void: "Void",
};

export type VendorAdjustmentInvoiceOption = {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  currency: string;
  amount: number;
  netBalance: number;
};

export type VendorAdjustmentProductOption = {
  id: string;
  supplierId: string;
  name: string;
  sku: string;
  cost: number;
  quantity: number;
};

export type VendorAdjustmentLineItemInput = {
  productId?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  amount?: unknown;
};

export type VendorAdjustmentPayload = {
  supplierId?: unknown;
  invoiceId?: unknown;
  adjustmentType?: unknown;
  status?: unknown;
  adjustmentDate?: unknown;
  amount?: unknown;
  currency?: unknown;
  reason?: unknown;
  notes?: unknown;
  inventoryImpact?: unknown;
  items?: unknown;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeVendorAdjustmentText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

export function normalizeVendorAdjustmentAmount(value: unknown) {
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

export function normalizeVendorAdjustmentQuantity(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(Math.round(value), 0);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());

    if (Number.isFinite(parsed)) {
      return Math.max(Math.round(parsed), 0);
    }
  }

  return 0;
}

export function normalizeVendorAdjustmentType(
  value: unknown,
): VendorAdjustmentType {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as VendorAdjustmentType;

    if (VENDOR_ADJUSTMENT_TYPES.includes(normalized)) {
      return normalized;
    }
  }

  return "other";
}

export function normalizeVendorAdjustmentStatus(
  value: unknown,
): VendorAdjustmentStatus {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as VendorAdjustmentStatus;

    if (VENDOR_ADJUSTMENT_STATUSES.includes(normalized)) {
      return normalized;
    }
  }

  return "draft";
}

export function isPostedVendorAdjustmentStatus(
  status: VendorAdjustmentStatus,
) {
  return status === "approved";
}

export function calculateVendorAdjustmentItemAmount(
  item: Partial<VendorAdjustmentItem>,
) {
  const quantity = normalizeVendorAdjustmentQuantity(item.quantity);
  const unitCost = normalizeVendorAdjustmentAmount(item.unitCost);

  if (quantity <= 0 || unitCost <= 0) {
    return normalizeVendorAdjustmentAmount(item.amount);
  }

  return roundCurrency(quantity * unitCost);
}

export function normalizeVendorAdjustmentItems(
  value: unknown,
): Array<Omit<VendorAdjustmentItem, "id">> {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: Array<Omit<VendorAdjustmentItem, "id">> = [];

  value.forEach((item) => {
    const record =
      typeof item === "object" && item !== null
        ? (item as VendorAdjustmentLineItemInput)
        : {};
    const description = normalizeVendorAdjustmentText(record.description);
    const productId = normalizeVendorAdjustmentText(record.productId);
    const quantity = normalizeVendorAdjustmentQuantity(record.quantity);
    const unitCost = normalizeVendorAdjustmentAmount(record.unitCost);
    const amount = calculateVendorAdjustmentItemAmount({
      quantity,
      unitCost,
      amount: normalizeVendorAdjustmentAmount(record.amount),
    });

    if (!productId && !description) {
      return;
    }

    if (quantity <= 0 && amount <= 0) {
      return;
    }

    items.push({
      productId: productId || undefined,
      description,
      quantity,
      unitCost,
      amount,
    });
  });

  return items;
}

export function calculateVendorAdjustmentItemsTotal(
  items: Array<Partial<VendorAdjustmentItem>>,
) {
  return roundCurrency(
    items.reduce(
      (sum, item) => sum + calculateVendorAdjustmentItemAmount(item),
      0,
    ),
  );
}

export function summarizeVendorAdjustmentInventoryItems(
  items: Array<Pick<VendorAdjustmentItem, "productId" | "description" | "quantity" | "unitCost" | "amount">>,
) {
  const summary = new Map<
    string,
    {
      quantity: number;
      amount: number;
      description: string;
      unitCost: number;
    }
  >();

  items.forEach((item) => {
    if (!item.productId || item.quantity <= 0) {
      return;
    }

    const current = summary.get(item.productId) ?? {
      quantity: 0,
      amount: 0,
      description: item.description,
      unitCost: 0,
    };

    current.quantity += normalizeVendorAdjustmentQuantity(item.quantity);
    current.amount += calculateVendorAdjustmentItemAmount(item);
    current.description = item.description || current.description;
    current.unitCost =
      current.quantity > 0 ? roundCurrency(current.amount / current.quantity) : 0;

    summary.set(item.productId, current);
  });

  return summary;
}

export function toIsoVendorAdjustmentDate(value: unknown) {
  const normalized = normalizeVendorAdjustmentText(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function buildVendorAdjustmentNumber(adjustmentDate: string) {
  const dateSegment = adjustmentDate.replace(/-/g, "");
  const randomSegment = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ADJ-${dateSegment}-${randomSegment}`;
}

export function formatVendorAdjustmentType(type: VendorAdjustmentType) {
  return VENDOR_ADJUSTMENT_TYPE_LABELS[type] ?? "Adjustment";
}

export function formatVendorAdjustmentStatus(status: VendorAdjustmentStatus) {
  return VENDOR_ADJUSTMENT_STATUS_LABELS[status] ?? "Draft";
}
