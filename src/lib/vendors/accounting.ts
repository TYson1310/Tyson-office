import { createClient } from "@/lib/supabase/server";
import {
  calculateVendorInvoiceNetBalance,
  deriveVendorInvoiceStatus,
} from "./accounting-core";
import { isPostedVendorPaymentStatus } from "./payments";

export type VendorInvoiceLedgerStatus =
  | "pending"
  | "paid"
  | "overdue"
  | "cancelled";

type InvoiceLedgerRow = {
  id: string;
  amount: number | string;
  due_date: string;
  status: VendorInvoiceLedgerStatus;
};

type PaymentLedgerRow = {
  amount_paid: number | string;
  status: "posted" | "void";
};

type AdjustmentLedgerRow = {
  amount: number | string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type VendorInvoiceLedgerSummary = {
  invoiceId: string;
  invoiceAmount: number;
  dueDate: string;
  currentStatus: VendorInvoiceLedgerStatus;
  totalPayments: number;
  totalAdjustments: number;
  paidAmount: number;
  netBalance: number;
  derivedStatus: Exclude<VendorInvoiceLedgerStatus, "cancelled">;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

export { calculateVendorInvoiceNetBalance, deriveVendorInvoiceStatus };

export async function getVendorInvoiceLedgerSummary(
  supabase: SupabaseServerClient,
  storeKey: string,
  invoiceId: string,
): Promise<VendorInvoiceLedgerSummary | null> {
  const { data: invoice, error: invoiceError } = await supabase
    .from("vendor_invoices")
    .select("id,amount,due_date,status")
    .eq("id", invoiceId)
    .eq("store_key", storeKey)
    .maybeSingle<InvoiceLedgerRow>();

  if (invoiceError) {
    throw invoiceError;
  }

  if (!invoice) {
    return null;
  }

  const [{ data: payments, error: paymentsError }, { data: adjustments, error: adjustmentsError }] =
    await Promise.all([
      supabase
        .from("vendor_payments")
        .select("amount_paid,status")
        .eq("store_key", storeKey)
        .eq("vendor_invoice_id", invoiceId)
        .returns<PaymentLedgerRow[]>(),
      supabase
        .from("vendor_adjustments")
        .select("amount")
        .eq("store_key", storeKey)
        .eq("vendor_invoice_id", invoiceId)
        .eq("status", "approved")
        .returns<AdjustmentLedgerRow[]>(),
    ]);

  if (paymentsError) {
    throw paymentsError;
  }

  if (adjustmentsError) {
    throw adjustmentsError;
  }

  const invoiceAmount = roundCurrency(toNumber(invoice.amount));
  const totalPayments = roundCurrency(
    (payments ?? []).reduce(
      (sum, row) =>
        isPostedVendorPaymentStatus(row.status)
          ? sum + toNumber(row.amount_paid)
          : sum,
      0,
    ),
  );
  const totalAdjustments = roundCurrency(
    (adjustments ?? []).reduce((sum, row) => sum + toNumber(row.amount), 0),
  );
  const netBalance = calculateVendorInvoiceNetBalance({
    invoiceAmount,
    totalPayments,
    totalAdjustments,
  });

  return {
    invoiceId: invoice.id,
    invoiceAmount,
    dueDate: invoice.due_date,
    currentStatus: invoice.status,
    totalPayments,
    totalAdjustments,
    paidAmount: totalPayments,
    netBalance,
    derivedStatus: deriveVendorInvoiceStatus({
      dueDate: invoice.due_date,
      netBalance,
    }),
  };
}

export async function syncVendorInvoiceLedger(
  supabase: SupabaseServerClient,
  storeKey: string,
  invoiceId: string,
  options?: {
    forceStatus?: VendorInvoiceLedgerStatus | null;
  },
) {
  const summary = await getVendorInvoiceLedgerSummary(supabase, storeKey, invoiceId);

  if (!summary) {
    return null;
  }

  const nextStatus =
    options?.forceStatus ??
    (summary.currentStatus === "cancelled"
      ? "cancelled"
      : summary.derivedStatus);

  const { error } = await supabase
    .from("vendor_invoices")
    .update({
      paid_amount: summary.paidAmount,
      status: nextStatus,
    })
    .eq("id", invoiceId)
    .eq("store_key", storeKey);

  if (error) {
    throw error;
  }

  return {
    ...summary,
    status: nextStatus,
  };
}
