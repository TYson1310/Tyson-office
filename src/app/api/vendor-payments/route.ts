import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { appendAuditEvent } from "@/lib/audit/events";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { syncVendorInvoiceLedger } from "@/lib/vendors/accounting";
import {
  normalizeVendorPaymentAmount,
  normalizeVendorPaymentMethod,
  normalizeVendorPaymentStatus,
  normalizeVendorPaymentText,
  toIsoVendorPaymentDate,
  type VendorPaymentPayload,
} from "@/lib/vendors/payments";
import { requireVendorManagerAccess } from "@/lib/vendors/api";

export const runtime = "nodejs";

type SupplierRow = {
  id: string;
  name: string;
};

type VendorInvoiceRow = {
  id: string;
  supplier_id: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
};

type VendorPaymentRow = {
  id: string;
  payment_method: string;
  vendor_invoice_id: string | null;
  payment_date: string;
  status: "posted" | "void";
  reference_number: string;
};

type VendorPaymentAllocation = {
  amountPaid: number;
  invoiceId: string;
};

function buildPaymentReference(paymentDate: string) {
  const dateSegment = paymentDate.replace(/-/g, "");
  const randomSegment = randomUUID().slice(0, 8).toUpperCase();
  return `PAY-${dateSegment}-${randomSegment}`;
}

function buildBatchPaymentReference(
  baseReferenceNumber: string,
  index: number,
  paymentCount: number,
) {
  if (paymentCount <= 1) {
    return baseReferenceNumber;
  }

  return `${baseReferenceNumber}-${String(index + 1).padStart(2, "0")}`;
}

function getPaymentId(body: VendorPaymentPayload) {
  return normalizeVendorPaymentText(body.id);
}

function normalizeVendorPaymentAllocations(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as VendorPaymentAllocation[];
  }

  return value
    .map((entry) => {
      const record =
        typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>)
          : {};
      const invoiceId = normalizeVendorPaymentText(record.invoiceId);
      const amountPaid = normalizeVendorPaymentAmount(record.amountPaid);

      return invoiceId && amountPaid > 0
        ? {
            amountPaid,
            invoiceId,
          }
        : null;
    })
    .filter((entry): entry is VendorPaymentAllocation => Boolean(entry));
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as VendorPaymentPayload;
    const requestedSupplierId = normalizeVendorPaymentText(body.supplierId);
    const invoicePayments = normalizeVendorPaymentAllocations(
      body.invoicePayments,
    );
    const isBatchPayment = invoicePayments.length > 0;
    const invoiceId = isBatchPayment
      ? ""
      : normalizeVendorPaymentText(body.invoiceId);
    const paymentDate =
      toIsoVendorPaymentDate(body.paymentDate) ??
      getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
    const amountPaid = isBatchPayment
      ? Math.round(
          invoicePayments.reduce(
            (total, payment) => total + payment.amountPaid,
            0,
          ) * 100,
        ) / 100
      : normalizeVendorPaymentAmount(body.amountPaid);
    const paymentMethod = normalizeVendorPaymentMethod(body.paymentMethod);
    const referenceNumber =
      normalizeVendorPaymentText(body.referenceNumber) ||
      buildPaymentReference(paymentDate);
    const notes = normalizeVendorPaymentText(body.notes) || null;

    if (amountPaid <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than zero" },
        { status: 400 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      paymentDate,
      "This payment",
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    let linkedInvoice: VendorInvoiceRow | null = null;
    let batchPayments: Array<{
      amountPaid: number;
      invoice: VendorInvoiceRow;
    }> = [];

    if (invoiceId) {
      const { data, error } = await access.supabase
        .from("vendor_invoices")
        .select("id,supplier_id,status")
        .eq("id", invoiceId)
        .eq("store_key", access.activeStoreKey)
        .maybeSingle<VendorInvoiceRow>();

      if (error) {
        return NextResponse.json(
          { error: error.message ?? "Failed to load invoice" },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Linked invoice was not found" },
          { status: 404 },
        );
      }

      linkedInvoice = data;
    }

    const supplierId = requestedSupplierId || linkedInvoice?.supplier_id || "";

    if (!supplierId) {
      return NextResponse.json(
        { error: "Supplier is required" },
        { status: 400 },
      );
    }

    const { data: supplier, error: supplierError } = await access.supabase
      .from("suppliers")
      .select("id,name")
      .eq("id", supplierId)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<SupplierRow>();

    if (supplierError) {
      return NextResponse.json(
        { error: supplierError.message ?? "Failed to load supplier" },
        { status: 500 },
      );
    }

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier was not found" },
        { status: 404 },
      );
    }

    if (linkedInvoice && linkedInvoice.supplier_id !== supplierId) {
      return NextResponse.json(
        { error: "Linked invoice does not belong to the selected supplier" },
        { status: 400 },
      );
    }

    if (isBatchPayment) {
      const uniqueInvoiceIds = Array.from(
        new Set(invoicePayments.map((payment) => payment.invoiceId)),
      );

      if (uniqueInvoiceIds.length !== invoicePayments.length) {
        return NextResponse.json(
          {
            error: "Each invoice can only be included once in a batch payment",
          },
          { status: 400 },
        );
      }

      const { data: invoicesToPay, error: invoicesToPayError } =
        await access.supabase
          .from("vendor_invoices")
          .select("id,supplier_id,status")
          .eq("store_key", access.activeStoreKey)
          .in("id", uniqueInvoiceIds)
          .returns<VendorInvoiceRow[]>();

      if (invoicesToPayError) {
        return NextResponse.json(
          {
            error:
              invoicesToPayError.message ??
              "Failed to load invoices for batch payment",
          },
          { status: 500 },
        );
      }

      if ((invoicesToPay ?? []).length !== uniqueInvoiceIds.length) {
        return NextResponse.json(
          { error: "One or more selected invoices were not found" },
          { status: 404 },
        );
      }

      const invoiceById = new Map(
        (invoicesToPay ?? []).map((invoice) => [invoice.id, invoice]),
      );

      for (const payment of invoicePayments) {
        const invoice = invoiceById.get(payment.invoiceId);

        if (!invoice) {
          return NextResponse.json(
            { error: "One or more selected invoices were not found" },
            { status: 404 },
          );
        }

        if (invoice.supplier_id !== supplierId) {
          return NextResponse.json(
            {
              error:
                "All selected invoices must belong to the selected supplier",
            },
            { status: 400 },
          );
        }

        if (invoice.status === "cancelled") {
          return NextResponse.json(
            { error: "Cancelled invoices cannot receive payments" },
            { status: 400 },
          );
        }

        const summary = await syncVendorInvoiceLedger(
          access.supabase,
          access.activeStoreKey,
          invoice.id,
        );

        if (!summary) {
          return NextResponse.json(
            { error: "One or more selected invoices were not found" },
            { status: 404 },
          );
        }

        const outstandingBalance = Math.max(summary.netBalance, 0);

        if (outstandingBalance <= 0) {
          return NextResponse.json(
            {
              error: `Invoice ${invoice.id} has no remaining balance to pay`,
            },
            { status: 400 },
          );
        }

        if (payment.amountPaid > outstandingBalance + 0.005) {
          return NextResponse.json(
            {
              error:
                "A batch payment amount cannot exceed an invoice balance after supplier adjustments.",
            },
            { status: 400 },
          );
        }

        batchPayments.push({
          amountPaid: payment.amountPaid,
          invoice,
        });
      }
    }

    if (linkedInvoice?.status === "cancelled") {
      return NextResponse.json(
        { error: "Cancelled invoices cannot receive payments" },
        { status: 400 },
      );
    }

    if (linkedInvoice) {
      const summary = await syncVendorInvoiceLedger(
        access.supabase,
        access.activeStoreKey,
        linkedInvoice.id,
      );

      if (!summary) {
        return NextResponse.json(
          { error: "Linked invoice was not found" },
          { status: 404 },
        );
      }

      const outstandingBalance = Math.max(summary.netBalance, 0);

      if (outstandingBalance <= 0) {
        return NextResponse.json(
          { error: "This invoice has no remaining balance to pay" },
          { status: 400 },
        );
      }

      if (amountPaid > outstandingBalance + 0.005) {
        return NextResponse.json(
          {
            error:
              "Payment amount cannot exceed the invoice balance after supplier adjustments.",
          },
          { status: 400 },
        );
      }
    }

    const paymentRows = isBatchPayment
      ? batchPayments.map((payment, index) => ({
          store_key: access.activeStoreKey,
          supplier_id: supplierId,
          vendor_invoice_id: payment.invoice.id,
          status: "posted",
          amount_paid: payment.amountPaid,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          reference_number: buildBatchPaymentReference(
            referenceNumber,
            index,
            batchPayments.length,
          ),
          notes,
          approved_by: access.currentUser.id,
          approved_at: new Date().toISOString(),
        }))
      : [
          {
            store_key: access.activeStoreKey,
            supplier_id: supplierId,
            vendor_invoice_id: linkedInvoice?.id ?? null,
            status: "posted",
            amount_paid: amountPaid,
            payment_date: paymentDate,
            payment_method: paymentMethod,
            reference_number: referenceNumber,
            notes,
            approved_by: access.currentUser.id,
            approved_at: new Date().toISOString(),
          },
        ];

    const { data: createdPayments, error: insertError } = await access.supabase
      .from("vendor_payments")
      .insert(paymentRows)
      .select("id,vendor_invoice_id,payment_date,status,reference_number")
      .returns<VendorPaymentRow[]>();

    if (insertError || !createdPayments || createdPayments.length === 0) {
      return NextResponse.json(
        {
          error:
            insertError?.code === "23505"
              ? "A payment with that reference number already exists"
              : (insertError?.message ?? "Failed to record vendor payment"),
        },
        { status: insertError?.code === "23505" ? 409 : 500 },
      );
    }

    await Promise.all(
      Array.from(
        new Set(
          createdPayments
            .map((payment) => payment.vendor_invoice_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ).map((paymentInvoiceId) =>
        syncVendorInvoiceLedger(
          access.supabase,
          access.activeStoreKey,
          paymentInvoiceId,
        ),
      ),
    );

    const firstPayment = createdPayments[0];

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_payment",
      entityId: firstPayment.id,
      action:
        createdPayments.length > 1
          ? "vendor_payment.batch_posted"
          : "vendor_payment.posted",
      summary:
        createdPayments.length > 1
          ? `Vendor payment batch posted: ${referenceNumber}`
          : `Vendor payment posted: ${referenceNumber}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        supplierId,
        supplierName: supplier.name,
        invoiceId: firstPayment.vendor_invoice_id,
        invoiceIds: createdPayments
          .map((payment) => payment.vendor_invoice_id)
          .filter(Boolean),
        paymentDate: firstPayment.payment_date,
        amountPaid,
        paymentMethod,
        referenceNumber,
        paymentCount: createdPayments.length,
        status: firstPayment.status,
      },
    });

    return NextResponse.json(
      {
        id: firstPayment.id,
        paymentCount: createdPayments.length,
        referenceNumber,
        supplierId,
        supplierName: supplier.name,
        status: firstPayment.status,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Vendor payment creation error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record vendor payment",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as VendorPaymentPayload;
    const id = getPaymentId(body);
    const requestedStatus =
      body.status === undefined
        ? null
        : normalizeVendorPaymentStatus(body.status);
    const requestedPaymentMethod =
      body.paymentMethod === undefined
        ? null
        : normalizeVendorPaymentMethod(body.paymentMethod);

    if (!id) {
      return NextResponse.json(
        { error: "Payment id is required" },
        { status: 400 },
      );
    }

    if (requestedStatus !== "void" && !requestedPaymentMethod) {
      return NextResponse.json(
        { error: "Choose a payment type to update or void the payment" },
        { status: 400 },
      );
    }

    const { data: payment, error: paymentError } = await access.supabase
      .from("vendor_payments")
      .select(
        "id,vendor_invoice_id,payment_date,status,reference_number,payment_method",
      )
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<VendorPaymentRow>();

    if (paymentError) {
      return NextResponse.json(
        { error: paymentError.message ?? "Failed to load vendor payment" },
        { status: 500 },
      );
    }

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (requestedPaymentMethod && requestedStatus !== "void") {
      if (payment.status === "void") {
        return NextResponse.json(
          { error: "Voided payments cannot be edited" },
          { status: 400 },
        );
      }

      const periodLock = await assertAccountingPeriodUnlocked(
        access.supabase,
        access.activeStoreKey,
        payment.payment_date,
        `Payment ${payment.reference_number}`,
      );

      if (periodLock) {
        return NextResponse.json(
          { error: periodLock.error },
          { status: periodLock.status },
        );
      }

      const { data: updatedPayment, error: updateError } = await access.supabase
        .from("vendor_payments")
        .update({
          payment_method: requestedPaymentMethod,
        })
        .eq("id", id)
        .eq("store_key", access.activeStoreKey)
        .select("id,vendor_invoice_id,status,payment_method")
        .maybeSingle<
          Pick<
            VendorPaymentRow,
            "id" | "vendor_invoice_id" | "status" | "payment_method"
          >
        >();

      if (updateError || !updatedPayment) {
        return NextResponse.json(
          {
            error:
              updateError?.message ?? "Failed to update vendor payment type",
          },
          { status: updateError ? 500 : 404 },
        );
      }

      await appendAuditEvent({
        supabase: access.supabase,
        storeKey: access.activeStoreKey,
        entityType: "vendor_payment",
        entityId: updatedPayment.id,
        action: "vendor_payment.method_updated",
        summary: `Vendor payment type updated: ${payment.reference_number}`,
        actorId: access.currentUser.id,
        actorName: access.currentUserName,
        actorRole: access.currentUserRole ?? "employee",
        metadata: {
          invoiceId: updatedPayment.vendor_invoice_id,
          paymentDate: payment.payment_date,
          referenceNumber: payment.reference_number,
          previousPaymentMethod: normalizeVendorPaymentMethod(
            payment.payment_method,
          ),
          nextPaymentMethod: updatedPayment.payment_method,
          status: updatedPayment.status,
        },
      });

      return NextResponse.json({
        success: true,
        id: updatedPayment.id,
        paymentMethod: updatedPayment.payment_method,
        status: updatedPayment.status,
      });
    }

    if (payment.status === "void") {
      return NextResponse.json({
        success: true,
        id: payment.id,
        status: payment.status,
      });
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      payment.payment_date,
      `Payment ${payment.reference_number}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    const { data: updatedPayment, error: updateError } = await access.supabase
      .from("vendor_payments")
      .update({
        status: "void",
        voided_by: access.currentUser.id,
        voided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id,vendor_invoice_id,status")
      .maybeSingle<
        Pick<VendorPaymentRow, "id" | "vendor_invoice_id" | "status">
      >();

    if (updateError || !updatedPayment) {
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to void vendor payment" },
        { status: updateError ? 500 : 404 },
      );
    }

    if (updatedPayment.vendor_invoice_id) {
      await syncVendorInvoiceLedger(
        access.supabase,
        access.activeStoreKey,
        updatedPayment.vendor_invoice_id,
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_payment",
      entityId: updatedPayment.id,
      action: "vendor_payment.voided",
      summary: `Vendor payment voided: ${payment.reference_number}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        invoiceId: updatedPayment.vendor_invoice_id,
        paymentDate: payment.payment_date,
        referenceNumber: payment.reference_number,
        previousStatus: payment.status,
        nextStatus: updatedPayment.status,
      },
    });

    return NextResponse.json({
      success: true,
      id: updatedPayment.id,
      status: updatedPayment.status,
    });
  } catch (error) {
    console.error("Vendor payment update error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update vendor payment",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  return NextResponse.json(
    {
      error:
        "Vendor payments keep an audit trail. Void the payment instead of deleting it.",
    },
    { status: 405 },
  );
}
