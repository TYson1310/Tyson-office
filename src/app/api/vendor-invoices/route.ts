import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import {
  FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE,
  isMissingFinancialAccountabilityMigration,
  loadFinancialAccountabilityStatus,
} from "@/lib/accountability/financial-controls";
import { appendAuditEvent } from "@/lib/audit/events";
import { getVendorInvoiceDocumentsBucket } from "@/lib/supabase/env";
import { syncVendorInvoiceLedger } from "@/lib/vendors/accounting";
import { requireVendorManagerAccess } from "@/lib/vendors/api";
import {
  buildInvoiceProductMatchKey,
  buildInvoiceProductSku,
  buildInvoiceDescription,
  buildInvoiceNotes,
  calculateInvoiceItemCatalogCost,
  calculateDueDateFromPaymentTerms,
  calculateInvoiceItemInventoryQuantity,
  calculateSellingPriceForMargin,
  isAllowedInvoiceFile,
  MAX_INVOICE_UPLOAD_BYTES,
  normalizeInvoiceAmount,
  normalizeInvoiceBarcode,
  normalizeInvoiceCurrency,
  normalizeInvoiceItemCode,
  normalizeInvoiceItems,
  normalizeOptionalInvoiceText,
  normalizeInvoiceText,
  sanitizeStorageFileName,
  toIsoInvoiceDate,
} from "@/lib/vendors/invoice-processing";
import type { PaymentTerms } from "@/types/erp.types";
import type { InvoiceVerificationPayload } from "@/types/types";

export const runtime = "nodejs";

const ALLOWED_VENDOR_INVOICE_STATUSES = new Set([
  "pending",
  "paid",
  "overdue",
  "cancelled",
]);
const INVOICE_PRODUCT_MARGIN_PERCENT = 40;

type SupplierRecord = {
  id: string;
  name: string;
  category: string | null;
  payment_terms: PaymentTerms | null;
};

type CreatedInvoiceResponse = {
  id: string;
  supplier_id: string;
  invoice_number: string;
};

type StoredInvoiceRecord = {
  id: string;
  pdf_url: string | null;
  issue_date: string;
  invoice_number: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
};

type ExistingInvoiceRecord = {
  id: string;
  supplier_id: string;
  issue_date: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
};

type VendorInvoiceMutationBody = {
  id?: unknown;
  supplierId?: unknown;
  invoiceNumber?: unknown;
  issueDate?: unknown;
  dueDate?: unknown;
  total?: unknown;
  currency?: unknown;
  description?: unknown;
  status?: unknown;
  paidAmount?: unknown;
  notes?: unknown;
};

type RelatedLedgerRecord = {
  id: string;
  status?: "posted" | "void";
};

type ProductRecord = {
  id: string;
  supplier_id: string | null;
  name: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  category: string;
  price: number | string;
  cost: number | string;
  quantity: number;
  reorder_level: number;
  location: string | null;
  daily_velocity: number | string;
  target_margin_percent: number | string;
};

type SyncedProductRecord = {
  id: string;
  name: string;
  sku: string;
  cost: number | string;
  quantity: number;
};

type ProductUpsertRecord = {
  store_key: string;
  supplier_id: string;
  name: string;
  description: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  cost: number;
  quantity: number;
  reorder_level: number;
  location: string | null;
  daily_velocity: number;
  target_margin_percent: number;
};

type InvoiceProductUpsertResult =
  | {
      upserts: ProductUpsertRecord[];
    }
  | {
      error: string;
    };

function toNumber(value: number | string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function buildDefaultProductCategory(supplier: SupplierRecord) {
  return normalizeInvoiceText(supplier.category) || "Uncategorized";
}

function normalizeVendorInvoiceStatus(value: unknown) {
  if (typeof value !== "string") {
    return "pending";
  }

  const normalized = value.trim().toLowerCase();
  return ALLOWED_VENDOR_INVOICE_STATUSES.has(normalized)
    ? normalized
    : "pending";
}

function buildInvoiceProductUpserts(
  storeKey: string,
  supplierId: string,
  supplier: SupplierRecord,
  items: InvoiceVerificationPayload["items"],
  existingProducts: ProductRecord[],
): InvoiceProductUpsertResult {
  const productsById = new Map<string, ProductRecord>();
  const existingBySku = new Map<string, ProductRecord>();
  const existingByBarcode = new Map<string, ProductRecord[]>();
  const existingByName = new Map<string, ProductRecord[]>();
  const existingByDescription = new Map<string, ProductRecord[]>();

  existingProducts.forEach((product) => {
    productsById.set(product.id, product);

    const skuKey = normalizeInvoiceItemCode(product.sku);
    const barcodeKey = normalizeInvoiceBarcode(product.barcode);
    const nameKey = buildInvoiceProductMatchKey(product.name);
    const descriptionKey = buildInvoiceProductMatchKey(
      product.description ?? "",
    );

    if (skuKey) {
      existingBySku.set(skuKey, product);
    }

    if (barcodeKey) {
      existingByBarcode.set(barcodeKey, [
        ...(existingByBarcode.get(barcodeKey) ?? []),
        product,
      ]);
    }

    if (nameKey) {
      existingByName.set(nameKey, [
        ...(existingByName.get(nameKey) ?? []),
        product,
      ]);
    }

    if (descriptionKey) {
      existingByDescription.set(descriptionKey, [
        ...(existingByDescription.get(descriptionKey) ?? []),
        product,
      ]);
    }
  });

  const aggregatedItems = new Map<
    string,
    {
      description: string;
      totalAmount: number;
      inventoryQuantity: number;
      fallbackCost: number;
      itemCode?: string;
      barcode?: string;
      matchedProductId?: string;
    }
  >();

  items.forEach((item) => {
    const description = normalizeInvoiceText(item.description);

    if (!description) {
      return;
    }

    const itemCode = normalizeInvoiceItemCode(item.itemCode);
    const barcode = normalizeInvoiceBarcode(item.itemCode);
    const matchedProductId = normalizeInvoiceText(item.matchedProductId);
    const key = matchedProductId
      ? `product:${matchedProductId}`
      : barcode
        ? `barcode:${barcode}`
        : itemCode
          ? `item-code:${itemCode}`
          : `description:${buildInvoiceProductMatchKey(description)}`;
    const existingEntry = aggregatedItems.get(key);
    const totalAmount =
      (existingEntry?.totalAmount ?? 0) + normalizeInvoiceAmount(item.amount);
    const inventoryQuantity =
      (existingEntry?.inventoryQuantity ?? 0) +
      Math.max(Math.round(calculateInvoiceItemInventoryQuantity(item)), 0);
    const fallbackCost = calculateInvoiceItemCatalogCost(item);

    aggregatedItems.set(key, {
      description: existingEntry?.description ?? description,
      totalAmount,
      inventoryQuantity,
      fallbackCost: fallbackCost || existingEntry?.fallbackCost || 0,
      itemCode: itemCode || existingEntry?.itemCode,
      barcode: barcode || existingEntry?.barcode,
      matchedProductId: matchedProductId || existingEntry?.matchedProductId,
    });
  });

  const defaultCategory = buildDefaultProductCategory(supplier);
  const ambiguousMatches = new Set<string>();
  const invalidSelections = new Set<string>();
  const upserts = Array.from(aggregatedItems.values())
    .map((entry) => {
      const generatedSku =
        entry.barcode || !entry.itemCode
          ? buildInvoiceProductSku(supplierId, entry.description)
          : entry.itemCode;
      const descriptionKey = buildInvoiceProductMatchKey(entry.description);
      let matchedProduct: ProductRecord | undefined;

      if (entry.matchedProductId) {
        matchedProduct = productsById.get(entry.matchedProductId);

        if (!matchedProduct) {
          invalidSelections.add(entry.description);
          return null;
        }
      } else {
        if (entry.barcode) {
          const barcodeMatches = existingByBarcode.get(entry.barcode) ?? [];

          if (barcodeMatches.length > 1) {
            ambiguousMatches.add(entry.description);
            return null;
          }

          matchedProduct =
            barcodeMatches[0] ??
            (entry.itemCode ? existingBySku.get(entry.itemCode) : undefined);
        }

        matchedProduct = matchedProduct ?? existingBySku.get(generatedSku);

        if (!matchedProduct) {
          const candidateMap = new Map<string, ProductRecord>();

          (existingByName.get(descriptionKey) ?? []).forEach((product) => {
            candidateMap.set(product.id, product);
          });
          (existingByDescription.get(descriptionKey) ?? []).forEach(
            (product) => {
              candidateMap.set(product.id, product);
            },
          );

          if (candidateMap.size > 1) {
            ambiguousMatches.add(entry.description);
            return null;
          }

          matchedProduct = Array.from(candidateMap.values())[0];
        }
      }

      const unitCost =
        entry.totalAmount > 0 && entry.inventoryQuantity > 0
          ? normalizeInvoiceAmount(entry.totalAmount / entry.inventoryQuantity)
          : entry.fallbackCost;

      if (entry.inventoryQuantity <= 0 || unitCost <= 0) {
        return null;
      }

      const productCost =
        unitCost > 0
          ? unitCost
          : matchedProduct
            ? toNumber(matchedProduct.cost)
            : 0;

      return {
        store_key: storeKey,
        supplier_id: supplierId,
        name: matchedProduct?.name || entry.description,
        description:
          normalizeInvoiceText(matchedProduct?.description ?? "") ||
          entry.description,
        sku: matchedProduct?.sku || generatedSku,
        barcode:
          normalizeInvoiceText(matchedProduct?.barcode ?? "") ||
          entry.barcode ||
          null,
        category:
          normalizeInvoiceText(matchedProduct?.category ?? "") ||
          defaultCategory,
        price: calculateSellingPriceForMargin(
          productCost,
          INVOICE_PRODUCT_MARGIN_PERCENT,
        ),
        cost: productCost,
        quantity:
          (matchedProduct?.quantity ?? 0) +
          Math.max(entry.inventoryQuantity, 0),
        reorder_level: matchedProduct?.reorder_level ?? 0,
        location: matchedProduct?.location ?? null,
        daily_velocity: matchedProduct
          ? toNumber(matchedProduct.daily_velocity)
          : 0,
        target_margin_percent: matchedProduct
          ? toNumber(matchedProduct.target_margin_percent)
          : INVOICE_PRODUCT_MARGIN_PERCENT,
      } satisfies ProductUpsertRecord;
    })
    .filter((entry): entry is ProductUpsertRecord => Boolean(entry));

  if (invalidSelections.size > 0) {
    return {
      error: `One or more selected products are invalid for this supplier: ${Array.from(
        invalidSelections,
      ).join(", ")}`,
    };
  }

  if (ambiguousMatches.size > 0) {
    return {
      error: `Multiple products already exist for this supplier and match: ${Array.from(
        ambiguousMatches,
      ).join(
        ", ",
      )}. Pick the correct product in the invoice review table before saving.`,
    };
  }

  return { upserts };
}

function validateInvoiceFile(file: File) {
  if (file.size <= 0) {
    return "Invoice file is empty";
  }

  if (file.size > MAX_INVOICE_UPLOAD_BYTES) {
    return "Invoice file must be 10MB or smaller";
  }

  if (!isAllowedInvoiceFile(file.name, file.type)) {
    return "Upload a PDF, PNG, JPG, or WEBP invoice";
  }

  return null;
}

function parsePayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as Partial<InvoiceVerificationPayload>;
  } catch {
    return null;
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as VendorInvoiceMutationBody;
    const id = normalizeInvoiceText(body.id);
    const supplierId = normalizeInvoiceText(body.supplierId);
    const invoiceNumber = normalizeInvoiceText(body.invoiceNumber);
    const issueDate = toIsoInvoiceDate(body.issueDate);
    const total = normalizeInvoiceAmount(body.total);

    if (!id) {
      return NextResponse.json(
        { error: "Invoice id is required" },
        { status: 400 },
      );
    }

    if (!supplierId || !invoiceNumber || !issueDate || total <= 0) {
      return NextResponse.json(
        {
          error:
            "Supplier, invoice number, issue date, and total amount are required",
        },
        { status: 400 },
      );
    }

    const { data: existingInvoice, error: existingInvoiceError } =
      await access.supabase
        .from("vendor_invoices")
        .select("id,supplier_id,issue_date,status")
        .eq("id", id)
        .eq("store_key", access.activeStoreKey)
        .maybeSingle<ExistingInvoiceRecord>();

    if (existingInvoiceError) {
      return NextResponse.json(
        {
          error:
            existingInvoiceError.message ?? "Failed to load current invoice",
        },
        { status: 500 },
      );
    }

    if (!existingInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      existingInvoice.issue_date,
      `Invoice ${invoiceNumber || id}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    const { data: supplier, error: supplierError } = await access.supabase
      .from("suppliers")
      .select("id,name,category,payment_terms")
      .eq("id", supplierId)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<SupplierRecord>();

    if (supplierError) {
      return NextResponse.json(
        { error: supplierError.message ?? "Failed to load supplier" },
        { status: 500 },
      );
    }

    if (!supplier) {
      return NextResponse.json(
        { error: "Selected supplier was not found" },
        { status: 404 },
      );
    }

    const dueDate =
      toIsoInvoiceDate(body.dueDate) ||
      calculateDueDateFromPaymentTerms(issueDate, supplier.payment_terms) ||
      issueDate;
    const currency = normalizeInvoiceCurrency(body.currency);
    const requestedStatus = normalizeVendorInvoiceStatus(body.status);

    if (
      typeof body.status === "string" &&
      !["pending", "cancelled"].includes(requestedStatus)
    ) {
      return NextResponse.json(
        {
          error:
            "Paid and overdue statuses are system-managed. Record payments or adjust due dates instead.",
        },
        { status: 400 },
      );
    }

    const description =
      normalizeOptionalInvoiceText(body.description) ??
      `Invoice ${invoiceNumber}`;
    const notes = normalizeOptionalInvoiceText(body.notes);

    if (existingInvoice.supplier_id !== supplierId) {
      const [
        { data: linkedPayments, error: paymentsError },
        { data: linkedAdjustments, error: adjustmentsError },
      ] = await Promise.all([
        access.supabase
          .from("vendor_payments")
          .select("id")
          .eq("store_key", access.activeStoreKey)
          .eq("vendor_invoice_id", id)
          .eq("status", "posted")
          .limit(1)
          .returns<RelatedLedgerRecord[]>(),
        access.supabase
          .from("vendor_adjustments")
          .select("id")
          .eq("store_key", access.activeStoreKey)
          .eq("vendor_invoice_id", id)
          .limit(1)
          .returns<RelatedLedgerRecord[]>(),
      ]);

      if (paymentsError || adjustmentsError) {
        return NextResponse.json(
          {
            error:
              paymentsError?.message ??
              adjustmentsError?.message ??
              "Failed to inspect linked ledger records",
          },
          { status: 500 },
        );
      }

      if (
        (linkedPayments?.length ?? 0) > 0 ||
        (linkedAdjustments?.length ?? 0) > 0
      ) {
        return NextResponse.json(
          {
            error:
              "Invoice supplier cannot be changed after payments or supplier adjustments have been recorded.",
          },
          { status: 409 },
        );
      }
    }

    if (requestedStatus === "cancelled") {
      const [
        { data: linkedPayments, error: paymentsError },
        { data: linkedAdjustments, error: adjustmentsError },
      ] = await Promise.all([
        access.supabase
          .from("vendor_payments")
          .select("id")
          .eq("store_key", access.activeStoreKey)
          .eq("vendor_invoice_id", id)
          .eq("status", "posted")
          .limit(1)
          .returns<RelatedLedgerRecord[]>(),
        access.supabase
          .from("vendor_adjustments")
          .select("id")
          .eq("store_key", access.activeStoreKey)
          .eq("vendor_invoice_id", id)
          .neq("status", "void")
          .limit(1)
          .returns<RelatedLedgerRecord[]>(),
      ]);

      if (paymentsError || adjustmentsError) {
        return NextResponse.json(
          {
            error:
              paymentsError?.message ??
              adjustmentsError?.message ??
              "Failed to inspect linked ledger records",
          },
          { status: 500 },
        );
      }

      if (
        (linkedPayments?.length ?? 0) > 0 ||
        (linkedAdjustments?.length ?? 0) > 0
      ) {
        return NextResponse.json(
          {
            error:
              "Void linked posted vendor payments and clear or void active supplier adjustments before cancelling this invoice.",
          },
          { status: 409 },
        );
      }
    }

    const { data: updatedInvoice, error: updateError } = await access.supabase
      .from("vendor_invoices")
      .update({
        supplier_id: supplierId,
        invoice_number: invoiceNumber,
        amount: total,
        currency,
        issue_date: issueDate,
        due_date: dueDate,
        description,
        status: requestedStatus === "cancelled" ? "cancelled" : "pending",
        notes,
      })
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id,supplier_id,invoice_number")
      .maybeSingle<CreatedInvoiceResponse>();

    if (updateError) {
      const isUniqueViolation = updateError.code === "23505";

      return NextResponse.json(
        {
          error: isUniqueViolation
            ? "An invoice with that number already exists"
            : (updateError.message ?? "Failed to update vendor invoice"),
        },
        { status: isUniqueViolation ? 409 : 500 },
      );
    }

    if (!updatedInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    await syncVendorInvoiceLedger(access.supabase, access.activeStoreKey, id, {
      forceStatus: requestedStatus === "cancelled" ? "cancelled" : null,
    });

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_invoice",
      entityId: updatedInvoice.id,
      action: "vendor_invoice.updated",
      summary: `Vendor invoice updated: ${updatedInvoice.invoice_number}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        supplierId: updatedInvoice.supplier_id,
        invoiceNumber: updatedInvoice.invoice_number,
        issueDate,
        dueDate,
        amount: total,
        currency,
        previousStatus: existingInvoice.status,
        nextStatus: requestedStatus === "cancelled" ? "cancelled" : "pending",
      },
    });

    return NextResponse.json({
      id: updatedInvoice.id,
      supplierId: updatedInvoice.supplier_id,
      invoiceNumber: updatedInvoice.invoice_number,
    });
  } catch (error) {
    console.error("Vendor invoice update error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update vendor invoice",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";

    if (!id) {
      return NextResponse.json(
        { error: "Invoice id is required" },
        { status: 400 },
      );
    }

    const { data: storedInvoice, error: storedInvoiceError } =
      await access.supabase
        .from("vendor_invoices")
        .select("id,pdf_url,issue_date,invoice_number,status")
        .eq("id", id)
        .eq("store_key", access.activeStoreKey)
        .maybeSingle<StoredInvoiceRecord>();

    if (storedInvoiceError) {
      return NextResponse.json(
        {
          error: storedInvoiceError.message ?? "Failed to load vendor invoice",
        },
        { status: 500 },
      );
    }

    if (!storedInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (storedInvoice.status === "cancelled") {
      return NextResponse.json({
        success: true,
        id: storedInvoice.id,
        status: storedInvoice.status,
      });
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      storedInvoice.issue_date,
      `Invoice ${id}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    const [
      { data: linkedPayments, error: paymentsError },
      { data: linkedAdjustments, error: adjustmentsError },
    ] = await Promise.all([
      access.supabase
        .from("vendor_payments")
        .select("id")
        .eq("store_key", access.activeStoreKey)
        .eq("vendor_invoice_id", id)
        .eq("status", "posted")
        .limit(1)
        .returns<RelatedLedgerRecord[]>(),
      access.supabase
        .from("vendor_adjustments")
        .select("id")
        .eq("store_key", access.activeStoreKey)
        .eq("vendor_invoice_id", id)
        .limit(1)
        .returns<RelatedLedgerRecord[]>(),
    ]);

    if (paymentsError || adjustmentsError) {
      return NextResponse.json(
        {
          error:
            paymentsError?.message ??
            adjustmentsError?.message ??
            "Failed to inspect linked payment records",
        },
        { status: 500 },
      );
    }

    if (
      (linkedPayments?.length ?? 0) > 0 ||
      (linkedAdjustments?.length ?? 0) > 0
    ) {
      return NextResponse.json(
        {
          error:
            "Void linked posted vendor payments and clear or void active supplier adjustments before cancelling this invoice.",
        },
        { status: 409 },
      );
    }

    const { data: cancelledInvoice, error: deleteError } = await access.supabase
      .from("vendor_invoices")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id")
      .maybeSingle<Pick<StoredInvoiceRecord, "id">>();

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message ?? "Failed to cancel vendor invoice" },
        { status: 500 },
      );
    }

    if (!cancelledInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    await syncVendorInvoiceLedger(access.supabase, access.activeStoreKey, id, {
      forceStatus: "cancelled",
    });

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_invoice",
      entityId: cancelledInvoice.id,
      action: "vendor_invoice.cancelled",
      summary: `Vendor invoice cancelled: ${storedInvoice.invoice_number}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        invoiceNumber: storedInvoice.invoice_number,
        issueDate: storedInvoice.issue_date,
        previousStatus: storedInvoice.status,
        nextStatus: "cancelled",
      },
    });

    return NextResponse.json({
      success: true,
      id: cancelledInvoice.id,
      status: "cancelled",
    });
  } catch (error) {
    console.error("Vendor invoice delete error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel vendor invoice",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const file =
      fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
    const rawEntryMode = normalizeInvoiceText(formData.get("entryMode"));
    const entryMode =
      rawEntryMode === "manual" ? "manual" : file ? "upload" : "manual";
    const payload = parsePayload(formData.get("payload"));

    const fileError = file ? validateInvoiceFile(file) : null;

    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    if (!payload) {
      return NextResponse.json(
        { error: "Invoice payload is invalid" },
        { status: 400 },
      );
    }

    const requestedSupplierId = normalizeInvoiceText(payload.supplierId);
    const invoiceNumber = normalizeInvoiceText(payload.invoiceNumber);
    const issueDate = toIsoInvoiceDate(payload.issueDate);
    const total = normalizeInvoiceAmount(payload.total);
    const extractedVendorName = normalizeInvoiceText(payload.vendorName);
    const extractedVendorAddress = normalizeOptionalInvoiceText(
      payload.vendorAddress,
    );

    if (
      !invoiceNumber ||
      !issueDate ||
      total <= 0 ||
      (!requestedSupplierId && !extractedVendorName)
    ) {
      return NextResponse.json(
        {
          error:
            "Vendor or extracted vendor name, invoice number, issue date, and total amount are required",
        },
        { status: 400 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      issueDate,
      `Invoice ${invoiceNumber}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    let supplierId = requestedSupplierId;
    let supplier: SupplierRecord | null = null;
    let supplierWasAutoCreated = false;

    if (supplierId) {
      const { data: selectedSupplier, error: supplierError } =
        await access.supabase
          .from("suppliers")
          .select("id,name,category,payment_terms")
          .eq("id", supplierId)
          .eq("store_key", access.activeStoreKey)
          .maybeSingle<SupplierRecord>();

      if (supplierError) {
        return NextResponse.json(
          { error: supplierError.message ?? "Failed to load supplier" },
          { status: 500 },
        );
      }

      if (!selectedSupplier) {
        return NextResponse.json(
          { error: "Selected supplier was not found" },
          { status: 404 },
        );
      }

      supplier = selectedSupplier;
    } else {
      const { data: supplierMatches, error: supplierLookupError } =
        await access.supabase
          .from("suppliers")
          .select("id,name,category,payment_terms")
          .eq("store_key", access.activeStoreKey)
          .ilike("name", extractedVendorName)
          .limit(5)
          .returns<SupplierRecord[]>();

      if (supplierLookupError) {
        return NextResponse.json(
          {
            error:
              supplierLookupError.message ?? "Failed to match extracted vendor",
          },
          { status: 500 },
        );
      }

      supplier =
        (supplierMatches ?? []).find(
          (record) =>
            normalizeInvoiceText(record.name).toLowerCase() ===
            extractedVendorName.toLowerCase(),
        ) ??
        (supplierMatches ?? [])[0] ??
        null;

      if (!supplier) {
        const { data: createdSupplier, error: createSupplierError } =
          await access.supabase
            .from("suppliers")
            .insert({
              store_key: access.activeStoreKey,
              name: extractedVendorName,
              address: extractedVendorAddress,
              payment_terms: "net30",
              status: "active",
            })
            .select("id,name,category,payment_terms")
            .single<SupplierRecord>();

        if (createSupplierError || !createdSupplier) {
          return NextResponse.json(
            {
              error:
                createSupplierError?.message ?? "Failed to auto-create vendor",
            },
            { status: 500 },
          );
        }

        supplier = createdSupplier;
        supplierWasAutoCreated = true;

        await appendAuditEvent({
          supabase: access.supabase,
          storeKey: access.activeStoreKey,
          entityType: "vendor",
          entityId: createdSupplier.id,
          action: "vendor.created",
          summary: `Vendor auto-created from invoice: ${createdSupplier.name}`,
          actorId: access.currentUser.id,
          actorName: access.currentUserName,
          actorRole: access.currentUserRole ?? "employee",
          metadata: {
            vendorName: createdSupplier.name,
            status: "active",
            paymentTerms: createdSupplier.payment_terms,
            source: "invoice_processing",
            address: extractedVendorAddress,
          },
        });
      }

      supplierId = supplier.id;
    }

    if (!supplier) {
      return NextResponse.json(
        { error: "Failed to resolve invoice vendor" },
        { status: 500 },
      );
    }

    const dueDate =
      toIsoInvoiceDate(payload.dueDate) ||
      calculateDueDateFromPaymentTerms(issueDate, supplier.payment_terms) ||
      issueDate;
    const autoCreatedSupplierId = supplierWasAutoCreated ? supplier.id : null;
    const currency = normalizeInvoiceCurrency(payload.currency);
    const items = normalizeInvoiceItems(payload.items);
    const description =
      buildInvoiceDescription(items, payload.description) ??
      `Invoice ${invoiceNumber}`;
    const notes =
      file && entryMode === "upload"
        ? (buildInvoiceNotes({
            ...payload,
            supplierId,
            invoiceNumber,
            issueDate,
            dueDate,
            currency,
            items,
            total,
            vendorName:
              normalizeInvoiceText(payload.vendorName) || supplier.name,
          }) ?? null)
        : (normalizeOptionalInvoiceText(payload.notes) ?? null);
    let productUpserts: ProductUpsertRecord[] = [];
    let existingProductsForSync: ProductRecord[] = [];
    let inventoryReceiptMovementCount = 0;

    if (items.length > 0) {
      const { data: existingProducts, error: productsError } =
        await access.supabase
          .from("products")
          .select(
            "id,supplier_id,name,description,sku,barcode,category,price,cost,quantity,reorder_level,location,daily_velocity,target_margin_percent",
          )
          .eq("store_key", access.activeStoreKey)
          .eq("supplier_id", supplierId)
          .returns<ProductRecord[]>();

      if (productsError) {
        return NextResponse.json(
          {
            error: productsError.message ?? "Failed to load existing products",
          },
          { status: 500 },
        );
      }

      existingProductsForSync = existingProducts ?? [];
      const upsertResult = buildInvoiceProductUpserts(
        access.activeStoreKey,
        supplierId,
        supplier,
        items,
        existingProducts ?? [],
      );

      if ("error" in upsertResult) {
        return NextResponse.json(
          { error: upsertResult.error },
          { status: 409 },
        );
      }

      productUpserts = upsertResult.upserts;

      if (productUpserts.length > 0) {
        const accountabilityStatus = await loadFinancialAccountabilityStatus(
          access.supabase,
          access.activeStoreKey,
        );

        if (!accountabilityStatus.available) {
          return NextResponse.json(
            {
              error:
                accountabilityStatus.warnings[0] ??
                FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE,
            },
            { status: 503 },
          );
        }
      }
    }

    const bucket = getVendorInvoiceDocumentsBucket();
    let storagePath: string | null = null;
    let storageFileName: string | null = null;
    let storageMimeType: string | null = null;

    if (file) {
      storageFileName = sanitizeStorageFileName(file.name);
      storageMimeType = file.type || "application/pdf";
      storagePath = `${access.activeStoreKey}/${access.currentUser.id}/${issueDate}/${randomUUID()}-${storageFileName}`;
      const { error: uploadError } = await access.supabase.storage
        .from(bucket)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: storageMimeType,
          upsert: false,
        });

      if (uploadError) {
        if (autoCreatedSupplierId) {
          await access.supabase
            .from("suppliers")
            .delete()
            .eq("id", autoCreatedSupplierId)
            .eq("store_key", access.activeStoreKey);
        }

        const isMissingBucket =
          uploadError.message?.toLowerCase().includes("bucket") &&
          uploadError.message?.toLowerCase().includes("not found");

        return NextResponse.json(
          {
            error: isMissingBucket
              ? "Vendor invoice storage bucket is missing. Apply the latest Supabase migrations first."
              : (uploadError.message ?? "Failed to upload invoice file"),
          },
          { status: isMissingBucket ? 503 : 500 },
        );
      }
    }

    const { data: createdInvoice, error: insertError } = await access.supabase
      .from("vendor_invoices")
      .insert({
        store_key: access.activeStoreKey,
        supplier_id: supplierId,
        invoice_number: invoiceNumber,
        amount: total,
        currency,
        issue_date: issueDate,
        due_date: dueDate,
        pdf_file_name: storageFileName,
        pdf_mime_type: storageMimeType,
        pdf_path: storagePath,
        pdf_url: null,
        description,
        status: "pending",
        paid_amount: 0,
        notes,
      })
      .select("id,supplier_id,invoice_number")
      .single<CreatedInvoiceResponse>();

    if (insertError || !createdInvoice) {
      await Promise.allSettled([
        storagePath
          ? access.supabase.storage.from(bucket).remove([storagePath])
          : Promise.resolve(),
        autoCreatedSupplierId
          ? access.supabase
              .from("suppliers")
              .delete()
              .eq("id", autoCreatedSupplierId)
              .eq("store_key", access.activeStoreKey)
          : Promise.resolve(),
      ]);

      const isUniqueViolation = insertError?.code === "23505";

      return NextResponse.json(
        {
          error: isUniqueViolation
            ? "An invoice with that number already exists"
            : (insertError?.message ?? "Failed to save vendor invoice"),
        },
        { status: isUniqueViolation ? 409 : 500 },
      );
    }

    if (productUpserts.length > 0) {
      const { error: upsertProductsError } = await access.supabase
        .from("products")
        .upsert(productUpserts, { onConflict: "store_key,sku" });

      if (upsertProductsError) {
        await Promise.allSettled([
          access.supabase
            .from("vendor_invoices")
            .delete()
            .eq("id", createdInvoice.id),
          storagePath
            ? access.supabase.storage.from(bucket).remove([storagePath])
            : Promise.resolve(),
          autoCreatedSupplierId
            ? access.supabase
                .from("suppliers")
                .delete()
                .eq("id", autoCreatedSupplierId)
                .eq("store_key", access.activeStoreKey)
            : Promise.resolve(),
        ]);

        return NextResponse.json(
          {
            error:
              upsertProductsError.message ??
              "Failed to sync invoice items into products",
          },
          { status: 500 },
        );
      }

      const syncedSkus = productUpserts.map((product) => product.sku);
      const { data: syncedProducts, error: syncedProductsError } =
        await access.supabase
          .from("products")
          .select("id,name,sku,cost,quantity")
          .eq("store_key", access.activeStoreKey)
          .in("sku", syncedSkus)
          .returns<SyncedProductRecord[]>();

      if (syncedProductsError) {
        return NextResponse.json(
          {
            error:
              syncedProductsError.message ??
              "Failed to load synced invoice products",
          },
          { status: 500 },
        );
      }

      const syncedProductBySku = new Map(
        (syncedProducts ?? []).map((product) => [product.sku, product]),
      );
      const existingProductBySku = new Map(
        existingProductsForSync.map((product) => [product.sku, product]),
      );
      const inventoryMovementRows = productUpserts.flatMap((upsert) => {
        const syncedProduct = syncedProductBySku.get(upsert.sku);

        if (!syncedProduct) {
          return [];
        }

        const quantityBefore = Number(
          existingProductBySku.get(upsert.sku)?.quantity ?? 0,
        );
        const quantityAfter = Number(syncedProduct.quantity);
        const quantityDelta = quantityAfter - quantityBefore;

        if (quantityDelta <= 0) {
          return [];
        }

        const unitCost = Number(syncedProduct.cost ?? upsert.cost ?? 0);

        return [
          {
            created_by: access.currentUser.id,
            movement_type: "vendor_invoice_receipt",
            notes: `Invoice ${createdInvoice.invoice_number}`,
            product_id: syncedProduct.id,
            product_name: syncedProduct.name,
            product_sku: syncedProduct.sku,
            quantity_after: quantityAfter,
            quantity_before: quantityBefore,
            quantity_delta: quantityDelta,
            store_key: access.activeStoreKey,
            total_amount: normalizeInvoiceAmount(quantityDelta * unitCost),
            unit_cost: normalizeInvoiceAmount(unitCost),
            vendor_invoice_id: createdInvoice.id,
          },
        ];
      });

      if (inventoryMovementRows.length > 0) {
        const { error: movementError } = await access.supabase
          .from("inventory_movements")
          .insert(inventoryMovementRows);

        if (movementError) {
          if (isMissingFinancialAccountabilityMigration(movementError)) {
            return NextResponse.json(
              { error: FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE },
              { status: 503 },
            );
          }

          return NextResponse.json(
            {
              error:
                movementError.message ??
                "Failed to write invoice inventory movements",
            },
            { status: 500 },
          );
        }

        inventoryReceiptMovementCount = inventoryMovementRows.length;
      }
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_invoice",
      entityId: createdInvoice.id,
      action: "vendor_invoice.created",
      summary: `Vendor invoice created: ${createdInvoice.invoice_number}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        supplierId: createdInvoice.supplier_id,
        supplierName: supplier.name,
        invoiceNumber: createdInvoice.invoice_number,
        issueDate,
        dueDate,
        amount: total,
        currency,
        itemCount: items.length,
        inventoryReceiptMovementCount,
        productSyncCount: productUpserts.length,
        status: "pending",
        supplierAutoCreated: supplierWasAutoCreated,
        source:
          entryMode === "manual"
            ? file
              ? "manual_upload"
              : "manual"
            : "upload",
        documentAttached: Boolean(file),
      },
    });

    return NextResponse.json(
      {
        id: createdInvoice.id,
        supplierId: createdInvoice.supplier_id,
        invoiceNumber: createdInvoice.invoice_number,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Vendor invoice creation error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save vendor invoice",
      },
      { status: 500 },
    );
  }
}
