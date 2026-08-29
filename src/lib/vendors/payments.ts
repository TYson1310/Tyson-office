export const VENDOR_PAYMENT_METHODS = ["cash", "card", "check"] as const;

export type VendorPaymentMethod = (typeof VENDOR_PAYMENT_METHODS)[number];
export const VENDOR_PAYMENT_STATUSES = ["posted", "void"] as const;
export type VendorPaymentStatus = (typeof VENDOR_PAYMENT_STATUSES)[number];

export const VENDOR_PAYMENT_METHOD_LABELS: Record<VendorPaymentMethod, string> =
  {
    cash: "Cash",
    card: "Card",
    check: "Check",
  };

export const VENDOR_PAYMENT_STATUS_LABELS: Record<VendorPaymentStatus, string> =
  {
    posted: "Posted",
    void: "Void",
  };

export type VendorPaymentInvoiceOption = {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  currency: string;
  netBalance: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
};

export type VendorPaymentPayload = {
  supplierId?: unknown;
  invoiceId?: unknown;
  invoicePayments?: unknown;
  id?: unknown;
  amountPaid?: unknown;
  paymentDate?: unknown;
  paymentMethod?: unknown;
  referenceNumber?: unknown;
  notes?: unknown;
  status?: unknown;
};

export function normalizeVendorPaymentText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

export function normalizeVendorPaymentAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);

    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100) / 100;
    }
  }

  return 0;
}

export function normalizeVendorPaymentMethod(
  value: unknown,
): VendorPaymentMethod {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const legacyNormalized =
      normalized === "credit_card"
        ? "card"
        : normalized === "bank_transfer"
          ? "check"
          : normalized;

    if (
      VENDOR_PAYMENT_METHODS.includes(legacyNormalized as VendorPaymentMethod)
    ) {
      return legacyNormalized as VendorPaymentMethod;
    }
  }

  return "check";
}

export function formatVendorPaymentMethod(value: unknown) {
  return VENDOR_PAYMENT_METHOD_LABELS[normalizeVendorPaymentMethod(value)];
}

export function normalizeVendorPaymentStatus(
  value: unknown,
): VendorPaymentStatus {
  return value === "void" ? "void" : "posted";
}

export function isPostedVendorPaymentStatus(
  value: VendorPaymentStatus | null | undefined,
) {
  return value === "posted";
}

export function toIsoVendorPaymentDate(value: unknown) {
  const normalized = normalizeVendorPaymentText(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}
