import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { appendAuditEvent } from "@/lib/audit/events";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { getVendorInvoiceDocumentsBucket } from "@/lib/supabase/env";
import { syncVendorInvoiceLedger } from "@/lib/vendors/accounting";
import { requireVendorManagerAccess } from "@/lib/vendors/api";
import {
  calculateVendorAdjustmentItemsTotal,
  normalizeVendorAdjustmentAmount,
  normalizeVendorAdjustmentItems,
  normalizeVendorAdjustmentStatus,
  normalizeVendorAdjustmentText,
  normalizeVendorAdjustmentType,
  summarizeVendorAdjustmentInventoryItems,
  toIsoVendorAdjustmentDate,
  type VendorAdjustmentPayload,
} from "@/lib/vendors/adjustments";
import {
  isAllowedInvoiceFile,
  MAX_INVOICE_UPLOAD_BYTES,
  normalizeInvoiceCurrency,
  sanitizeStorageFileName,
} from "@/lib/vendors/invoice-processing";
import type { VendorAdjustmentStatus } from "@/types/erp.types";

export const runtime = "nodejs";

type SupplierRow = {
  id: string;
  name: string;
};

type VendorInvoiceRow = {
  id: string;
  supplier_id: string;
  invoice_number: string;
  currency: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
};

type ProductRow = {
  id: string;
  supplier_id: string | null;
  name: string;
  sku: string;
  cost: number | string;
  quantity: number;
};

type CreatedAdjustmentRow = {
  id: string;
  adjustment_number: string;
  status: VendorAdjustmentStatus;
};

type StoredAdjustmentRow = {
  id: string;
  supplier_id: string;
  vendor_invoice_id: string | null;
  adjustment_number: string;
  adjustment_date: string;
  status: VendorAdjustmentStatus;
  amount: number | string;
  inventory_impact: boolean;
  reason: string | null;
  notes: string | null;
  attachment_path: string | null;
  created_by: string | null;
};

type StoredAdjustmentItemRow = {
  product_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number | string;
  amount: number | string;
};

type InventoryMovementInsertRow = {
  id: string;
};

type ParsedAdjustmentRequest = {
  body: VendorAdjustmentPayload;
  attachment: File | null;
};

type UploadedAttachment = {
  attachment_name: string;
  attachment_path: string;
  attachment_url: null;
  attachment_mime_type: string;
};

type AppliedInventoryState = {
  productId: string;
  previousQuantity: number;
  movementId: string;
};

type AdjustmentMutationResult =
  | {
      nextStatus: "approved" | "void";
    }
  | {
      error: string;
      status: number;
    };

type AccessContext = Awaited<ReturnType<typeof requireVendorManagerAccess>>;
type VendorAccess = Exclude<AccessContext, { error: NextResponse }>;

function buildAdjustmentNumber(adjustmentDate: string) {
  const dateSegment = adjustmentDate.replace(/-/g, "");
  const randomSegment = randomUUID().slice(0, 8).toUpperCase();
  return `ADJ-${dateSegment}-${randomSegment}`;
}

function parsePayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as VendorAdjustmentPayload;
  } catch {
    return null;
  }
}

function validateAttachmentFile(file: File) {
  if (file.size <= 0) {
    return "Attachment file is empty";
  }

  if (file.size > MAX_INVOICE_UPLOAD_BYTES) {
    return "Attachment file must be 10MB or smaller";
  }

  if (!isAllowedInvoiceFile(file.name, file.type)) {
    return "Upload a PDF, PNG, JPG, or WEBP supporting document";
  }

  return null;
}

async function parseAdjustmentRequest(
  request: NextRequest,
): Promise<ParsedAdjustmentRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const attachmentEntry = formData.get("attachment");

    return {
      body: parsePayload(formData.get("payload")) ?? {},
      attachment:
        attachmentEntry instanceof File && attachmentEntry.size > 0
          ? attachmentEntry
          : null,
    };
  }

  return {
    body: (await request.json()) as VendorAdjustmentPayload,
    attachment: null,
  };
}

async function uploadAttachment(
  access: VendorAccess,
  file: File,
  adjustmentDate: string,
) {
  const validationError = validateAttachmentFile(file);

  if (validationError) {
    return { error: validationError, status: 400 as const };
  }

  const bucket = getVendorInvoiceDocumentsBucket();
  const storagePath = `adjustments/${access.activeStoreKey}/${access.currentUser.id}/${adjustmentDate}/${randomUUID()}-${sanitizeStorageFileName(file.name)}`;
  const { error } = await access.supabase.storage
    .from(bucket)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || "application/pdf",
      upsert: false,
    });

  if (error) {
    const isMissingBucket =
      error.message?.toLowerCase().includes("bucket") &&
      error.message?.toLowerCase().includes("not found");

    return {
      error: isMissingBucket
        ? "Vendor document storage bucket is missing. Apply the latest Supabase migrations first."
        : (error.message ?? "Failed to upload supporting document"),
      status: isMissingBucket ? 503 : 500,
    };
  }

  return {
    data: {
      attachment_name: file.name,
      attachment_path: storagePath,
      attachment_url: null,
      attachment_mime_type: file.type || "application/pdf",
    } satisfies UploadedAttachment,
  };
}

async function removeAttachment(
  access: VendorAccess,
  attachmentPath: string | null | undefined,
) {
  if (!attachmentPath) {
    return;
  }

  const bucket = getVendorInvoiceDocumentsBucket();
  await access.supabase.storage.from(bucket).remove([attachmentPath]);
}

async function loadStoredAdjustment(access: VendorAccess, id: string) {
  const { data, error } = await access.supabase
    .from("vendor_adjustments")
    .select(
      "id,supplier_id,vendor_invoice_id,adjustment_number,adjustment_date,status,amount,inventory_impact,reason,notes,attachment_path,created_by",
    )
    .eq("id", id)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<StoredAdjustmentRow>();

  if (error) {
    return {
      error: error.message ?? "Failed to load adjustment",
      status: 500 as const,
    };
  }

  if (!data) {
    return { error: "Adjustment not found", status: 404 as const };
  }

  return { data };
}

async function loadStoredAdjustmentItems(
  access: VendorAccess,
  adjustmentId: string,
) {
  const { data, error } = await access.supabase
    .from("vendor_adjustment_items")
    .select("product_id,description,quantity,unit_cost,amount")
    .eq("vendor_adjustment_id", adjustmentId)
    .returns<StoredAdjustmentItemRow[]>();

  if (error) {
    return {
      error: error.message ?? "Failed to load adjustment items",
      status: 500 as const,
    };
  }

  return { data: data ?? [] };
}

async function ensureLinkedInvoiceIsOpen(
  access: VendorAccess,
  invoiceId: string | null,
) {
  if (!invoiceId) {
    return { data: null };
  }

  const { data, error } = await access.supabase
    .from("vendor_invoices")
    .select("id,status")
    .eq("id", invoiceId)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<{ id: string; status: VendorInvoiceRow["status"] }>();

  if (error) {
    return {
      error: error.message ?? "Failed to load linked invoice",
      status: 500 as const,
    };
  }

  if (!data) {
    return { error: "Linked invoice was not found", status: 404 as const };
  }

  if (data.status === "cancelled") {
    return {
      error: "Cancelled invoices cannot receive supplier adjustments",
      status: 400 as const,
    };
  }

  return { data };
}

async function rollbackInventoryChanges(
  access: VendorAccess,
  appliedStates: AppliedInventoryState[],
) {
  if (appliedStates.length === 0) {
    return;
  }

  await Promise.allSettled(
    appliedStates.flatMap((entry) => [
      access.supabase
        .from("products")
        .update({ quantity: entry.previousQuantity })
        .eq("id", entry.productId)
        .eq("store_key", access.activeStoreKey),
      access.supabase
        .from("inventory_movements")
        .delete()
        .eq("id", entry.movementId)
        .eq("store_key", access.activeStoreKey),
    ]),
  );
}

async function applyInventoryMovements(
  access: VendorAccess,
  adjustment: StoredAdjustmentRow,
  items: StoredAdjustmentItemRow[],
  options: {
    movementType: "vendor_return" | "vendor_return_reversal";
    quantityMultiplier: -1 | 1;
    requireSupplierMatch: boolean;
  },
) {
  const inventorySummary = summarizeVendorAdjustmentInventoryItems(
    items.map((item) => ({
      productId: item.product_id ?? undefined,
      description: item.description,
      quantity: item.quantity,
      unitCost: normalizeVendorAdjustmentAmount(item.unit_cost),
      amount: normalizeVendorAdjustmentAmount(item.amount),
    })),
  );

  const productIds = Array.from(inventorySummary.keys());

  if (productIds.length === 0) {
    return { appliedStates: [] as AppliedInventoryState[] };
  }

  const { data: products, error: productsError } = await access.supabase
    .from("products")
    .select("id,supplier_id,name,sku,cost,quantity")
    .eq("store_key", access.activeStoreKey)
    .in("id", productIds)
    .returns<ProductRow[]>();

  if (productsError) {
    return {
      error:
        productsError.message ??
        "Failed to load products for inventory posting",
      status: 500 as const,
    };
  }

  const productMap = new Map(
    (products ?? []).map((product) => [product.id, product]),
  );
  const appliedStates: AppliedInventoryState[] = [];
  const movementNote =
    adjustment.reason ??
    adjustment.notes ??
    `Supplier adjustment ${adjustment.adjustment_number}`;

  for (const [productId, delta] of inventorySummary.entries()) {
    const product = productMap.get(productId);

    if (!product) {
      await rollbackInventoryChanges(access, appliedStates);
      return {
        error: "One or more adjustment products no longer exist in inventory",
        status: 409 as const,
      };
    }

    if (
      options.requireSupplierMatch &&
      product.supplier_id !== adjustment.supplier_id
    ) {
      await rollbackInventoryChanges(access, appliedStates);
      return {
        error:
          "One or more adjustment products no longer belong to the selected supplier",
        status: 409 as const,
      };
    }

    if (options.quantityMultiplier < 0 && product.quantity < delta.quantity) {
      await rollbackInventoryChanges(access, appliedStates);
      return {
        error: "Return quantity exceeds the stock currently on hand",
        status: 409 as const,
      };
    }

    const nextQuantity =
      product.quantity + options.quantityMultiplier * delta.quantity;
    const { error: updateError } = await access.supabase
      .from("products")
      .update({ quantity: nextQuantity })
      .eq("id", productId)
      .eq("store_key", access.activeStoreKey);

    if (updateError) {
      await rollbackInventoryChanges(access, appliedStates);
      return {
        error: updateError.message ?? "Failed to update inventory",
        status: 500 as const,
      };
    }

    const { data: movement, error: movementError } = await access.supabase
      .from("inventory_movements")
      .insert({
        store_key: access.activeStoreKey,
        product_id: productId,
        vendor_adjustment_id: adjustment.id,
        movement_type: options.movementType,
        quantity_delta: options.quantityMultiplier * delta.quantity,
        quantity_before: product.quantity,
        quantity_after: nextQuantity,
        unit_cost: normalizeVendorAdjustmentAmount(
          delta.unitCost || product.cost,
        ),
        total_amount: normalizeVendorAdjustmentAmount(delta.amount),
        product_name: product.name,
        product_sku: product.sku,
        notes: movementNote,
        created_by: access.currentUser.id,
      })
      .select("id")
      .single<InventoryMovementInsertRow>();

    if (movementError || !movement) {
      await access.supabase
        .from("products")
        .update({ quantity: product.quantity })
        .eq("id", productId)
        .eq("store_key", access.activeStoreKey);

      await rollbackInventoryChanges(access, appliedStates);

      return {
        error:
          movementError?.message ??
          "Failed to write inventory movement history",
        status: 500 as const,
      };
    }

    appliedStates.push({
      productId,
      previousQuantity: product.quantity,
      movementId: movement.id,
    });
    product.quantity = nextQuantity;
  }

  return { appliedStates };
}

async function approveAdjustment(
  access: VendorAccess,
  adjustment: StoredAdjustmentRow,
): Promise<AdjustmentMutationResult> {
  if (adjustment.status !== "draft") {
    return {
      error: "Only draft adjustments can be approved",
      status: 409 as const,
    };
  }

  if (adjustment.created_by === access.currentUser.id) {
    return {
      error:
        "The user who created this supplier adjustment cannot approve it. Another manager or owner must review it.",
      status: 409 as const,
    };
  }

  const periodLock = await assertAccountingPeriodUnlocked(
    access.supabase,
    access.activeStoreKey,
    adjustment.adjustment_date,
    `Adjustment ${adjustment.adjustment_number}`,
  );

  if (periodLock) {
    return {
      error: periodLock.error,
      status: periodLock.status,
    };
  }

  const invoiceCheck = await ensureLinkedInvoiceIsOpen(
    access,
    adjustment.vendor_invoice_id,
  );

  if ("error" in invoiceCheck) {
    const failedInvoiceCheck = invoiceCheck as {
      error: string;
      status: number;
    };
    return {
      error: failedInvoiceCheck.error,
      status: failedInvoiceCheck.status,
    };
  }

  const itemsResult = await loadStoredAdjustmentItems(access, adjustment.id);

  if ("error" in itemsResult) {
    const failedItemsResult = itemsResult as { error: string; status: number };
    return {
      error: failedItemsResult.error,
      status: failedItemsResult.status,
    };
  }

  if (adjustment.inventory_impact && itemsResult.data.length === 0) {
    return {
      error: "Inventory-impact adjustments require at least one return item",
      status: 409 as const,
    };
  }

  const inventoryResult = adjustment.inventory_impact
    ? await applyInventoryMovements(access, adjustment, itemsResult.data, {
        movementType: "vendor_return",
        quantityMultiplier: -1,
        requireSupplierMatch: true,
      })
    : { appliedStates: [] as AppliedInventoryState[] };

  if ("error" in inventoryResult) {
    const failedInventoryResult = inventoryResult as {
      error: string;
      status: number;
    };
    return {
      error: failedInventoryResult.error,
      status: failedInventoryResult.status,
    };
  }

  const approvalPayload = {
    status: "approved" as const,
    approved_by: access.currentUser.id,
    approved_at: new Date().toISOString(),
    voided_by: null,
    voided_at: null,
  };
  const { error: updateError } = await access.supabase
    .from("vendor_adjustments")
    .update(approvalPayload)
    .eq("id", adjustment.id)
    .eq("store_key", access.activeStoreKey);

  if (updateError) {
    await rollbackInventoryChanges(access, inventoryResult.appliedStates);
    return {
      error: updateError.message ?? "Failed to approve adjustment",
      status: 500 as const,
    };
  }

  if (adjustment.vendor_invoice_id) {
    await syncVendorInvoiceLedger(
      access.supabase,
      access.activeStoreKey,
      adjustment.vendor_invoice_id,
    );
  }

  await appendAuditEvent({
    supabase: access.supabase,
    storeKey: access.activeStoreKey,
    entityType: "vendor_adjustment",
    entityId: adjustment.id,
    action: "vendor_adjustment.approved",
    summary: `Supplier adjustment approved: ${adjustment.adjustment_number}`,
    actorId: access.currentUser.id,
    actorName: access.currentUserName,
    actorRole: access.currentUserRole ?? "employee",
    metadata: {
      adjustmentNumber: adjustment.adjustment_number,
      adjustmentDate: adjustment.adjustment_date,
      amount: Number(adjustment.amount ?? 0),
      inventoryImpact: adjustment.inventory_impact,
    },
  });

  return { nextStatus: "approved" as const };
}

async function voidAdjustment(
  access: VendorAccess,
  adjustment: StoredAdjustmentRow,
): Promise<AdjustmentMutationResult> {
  if (adjustment.status !== "approved") {
    return {
      error: "Only approved adjustments can be voided",
      status: 409 as const,
    };
  }

  const periodLock = await assertAccountingPeriodUnlocked(
    access.supabase,
    access.activeStoreKey,
    adjustment.adjustment_date,
    `Adjustment ${adjustment.adjustment_number}`,
  );

  if (periodLock) {
    return {
      error: periodLock.error,
      status: periodLock.status,
    };
  }

  const itemsResult = await loadStoredAdjustmentItems(access, adjustment.id);

  if ("error" in itemsResult) {
    const failedItemsResult = itemsResult as { error: string; status: number };
    return {
      error: failedItemsResult.error,
      status: failedItemsResult.status,
    };
  }

  const inventoryResult = adjustment.inventory_impact
    ? await applyInventoryMovements(access, adjustment, itemsResult.data, {
        movementType: "vendor_return_reversal",
        quantityMultiplier: 1,
        requireSupplierMatch: false,
      })
    : { appliedStates: [] as AppliedInventoryState[] };

  if ("error" in inventoryResult) {
    const failedInventoryResult = inventoryResult as {
      error: string;
      status: number;
    };
    return {
      error: failedInventoryResult.error,
      status: failedInventoryResult.status,
    };
  }

  const { error: updateError } = await access.supabase
    .from("vendor_adjustments")
    .update({
      status: "void",
      voided_by: access.currentUser.id,
      voided_at: new Date().toISOString(),
    })
    .eq("id", adjustment.id)
    .eq("store_key", access.activeStoreKey);

  if (updateError) {
    await rollbackInventoryChanges(access, inventoryResult.appliedStates);
    return {
      error: updateError.message ?? "Failed to void adjustment",
      status: 500 as const,
    };
  }

  if (adjustment.vendor_invoice_id) {
    await syncVendorInvoiceLedger(
      access.supabase,
      access.activeStoreKey,
      adjustment.vendor_invoice_id,
    );
  }

  await appendAuditEvent({
    supabase: access.supabase,
    storeKey: access.activeStoreKey,
    entityType: "vendor_adjustment",
    entityId: adjustment.id,
    action: "vendor_adjustment.voided",
    summary: `Supplier adjustment voided: ${adjustment.adjustment_number}`,
    actorId: access.currentUser.id,
    actorName: access.currentUserName,
    actorRole: access.currentUserRole ?? "employee",
    metadata: {
      adjustmentNumber: adjustment.adjustment_number,
      adjustmentDate: adjustment.adjustment_date,
      amount: Number(adjustment.amount ?? 0),
      inventoryImpact: adjustment.inventory_impact,
    },
  });

  return { nextStatus: "void" as const };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const parsedRequest = await parseAdjustmentRequest(request);
    const body = parsedRequest.body;
    const requestedSupplierId = normalizeVendorAdjustmentText(body.supplierId);
    const invoiceId = normalizeVendorAdjustmentText(body.invoiceId);
    const requestedStatus = normalizeVendorAdjustmentStatus(body.status);
    const adjustmentType = normalizeVendorAdjustmentType(body.adjustmentType);
    const adjustmentDate =
      toIsoVendorAdjustmentDate(body.adjustmentDate) ??
      getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
    const inventoryImpact = Boolean(body.inventoryImpact);
    const reason = normalizeVendorAdjustmentText(body.reason) || null;
    const notes = normalizeVendorAdjustmentText(body.notes) || null;

    if (requestedStatus === "void") {
      return NextResponse.json(
        { error: "New adjustments can only be saved as draft or approved" },
        { status: 400 },
      );
    }

    if (requestedStatus === "approved") {
      return NextResponse.json(
        {
          error:
            "New supplier adjustments must be saved as draft. Another manager or owner must approve them.",
        },
        { status: 409 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      adjustmentDate,
      "This supplier adjustment",
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    let linkedInvoice: VendorInvoiceRow | null = null;

    if (invoiceId) {
      const { data, error } = await access.supabase
        .from("vendor_invoices")
        .select("id,supplier_id,invoice_number,currency,status")
        .eq("id", invoiceId)
        .eq("store_key", access.activeStoreKey)
        .maybeSingle<VendorInvoiceRow>();

      if (error) {
        return NextResponse.json(
          { error: error.message ?? "Failed to load vendor invoice" },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Linked invoice was not found" },
          { status: 404 },
        );
      }

      if (data.status === "cancelled") {
        return NextResponse.json(
          { error: "Cancelled invoices cannot receive supplier adjustments" },
          { status: 400 },
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

    if (
      inventoryImpact &&
      !["return", "damage", "other"].includes(adjustmentType)
    ) {
      return NextResponse.json(
        {
          error:
            "Inventory-impact adjustments are only supported for returns, damaged goods, or other supplier deductions.",
        },
        { status: 400 },
      );
    }

    const parsedItems = normalizeVendorAdjustmentItems(body.items);

    if (!inventoryImpact && parsedItems.length > 0) {
      return NextResponse.json(
        {
          error:
            "Line items are only supported when inventory impact is enabled.",
        },
        { status: 400 },
      );
    }

    if (inventoryImpact && parsedItems.length === 0) {
      return NextResponse.json(
        { error: "Add at least one product line for inventory returns" },
        { status: 400 },
      );
    }

    const currency = normalizeInvoiceCurrency(
      body.currency ?? linkedInvoice?.currency ?? "USD",
    );
    let amount = normalizeVendorAdjustmentAmount(body.amount);
    let createdItems: Array<{
      product_id: string;
      description: string;
      quantity: number;
      unit_cost: number;
      amount: number;
    }> = [];

    if (inventoryImpact) {
      const productIds = Array.from(
        new Set(
          parsedItems
            .map((item) => item.productId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      if (
        productIds.length === 0 ||
        parsedItems.some((item) => !item.productId)
      ) {
        return NextResponse.json(
          {
            error:
              "Every inventory return line must be linked to a supplier product.",
          },
          { status: 400 },
        );
      }

      const { data: products, error: productsError } = await access.supabase
        .from("products")
        .select("id,supplier_id,name,sku,cost,quantity")
        .eq("store_key", access.activeStoreKey)
        .in("id", productIds)
        .returns<ProductRow[]>();

      if (productsError) {
        return NextResponse.json(
          { error: productsError.message ?? "Failed to load products" },
          { status: 500 },
        );
      }

      const productMap = new Map(
        (products ?? []).map((product) => [product.id, product]),
      );
      const resolvedItems = parsedItems.map((item) => {
        const product = item.productId ? productMap.get(item.productId) : null;

        return {
          product,
          item,
        };
      });

      for (const entry of resolvedItems) {
        if (
          !entry.item.productId ||
          !entry.product ||
          entry.product.supplier_id !== supplierId
        ) {
          return NextResponse.json(
            {
              error:
                "One or more selected products do not belong to the selected supplier.",
            },
            { status: 400 },
          );
        }

        if (entry.item.quantity <= 0) {
          return NextResponse.json(
            { error: "Return quantities must be greater than zero" },
            { status: 400 },
          );
        }
      }

      createdItems = resolvedItems.map((entry) => {
        const product = entry.product as ProductRow;
        const unitCost =
          entry.item.unitCost > 0
            ? entry.item.unitCost
            : normalizeVendorAdjustmentAmount(product.cost);
        const lineAmount = normalizeVendorAdjustmentAmount(
          entry.item.quantity * unitCost,
        );

        return {
          product_id: product.id,
          description: entry.item.description || product.name,
          quantity: entry.item.quantity,
          unit_cost: unitCost,
          amount: lineAmount,
        };
      });

      amount = calculateVendorAdjustmentItemsTotal(
        createdItems.map((item) => ({
          quantity: item.quantity,
          unitCost: item.unit_cost,
          amount: item.amount,
        })),
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Adjustment amount must be greater than zero" },
        { status: 400 },
      );
    }

    let uploadedAttachment: UploadedAttachment | null = null;

    if (parsedRequest.attachment) {
      const uploadResult = await uploadAttachment(
        access,
        parsedRequest.attachment,
        adjustmentDate,
      );

      if ("error" in uploadResult) {
        return NextResponse.json(
          { error: uploadResult.error },
          { status: uploadResult.status },
        );
      }

      uploadedAttachment = uploadResult.data;
    }

    const adjustmentNumber = buildAdjustmentNumber(adjustmentDate);
    const { data: createdAdjustment, error: insertError } =
      await access.supabase
        .from("vendor_adjustments")
        .insert({
          store_key: access.activeStoreKey,
          supplier_id: supplierId,
          vendor_invoice_id: linkedInvoice?.id ?? null,
          adjustment_number: adjustmentNumber,
          adjustment_type: adjustmentType,
          status: "draft",
          amount,
          currency,
          adjustment_date: adjustmentDate,
          reason,
          notes,
          inventory_impact: inventoryImpact,
          ...(uploadedAttachment ?? {}),
          created_by: access.currentUser.id,
        })
        .select("id,adjustment_number,status")
        .single<CreatedAdjustmentRow>();

    if (insertError || !createdAdjustment) {
      await removeAttachment(access, uploadedAttachment?.attachment_path);

      return NextResponse.json(
        {
          error: insertError?.message ?? "Failed to create supplier adjustment",
        },
        { status: insertError?.code === "23505" ? 409 : 500 },
      );
    }

    if (createdItems.length > 0) {
      const { error: itemsError } = await access.supabase
        .from("vendor_adjustment_items")
        .insert(
          createdItems.map((item) => ({
            vendor_adjustment_id: createdAdjustment.id,
            ...item,
          })),
        );

      if (itemsError) {
        await access.supabase
          .from("vendor_adjustments")
          .delete()
          .eq("id", createdAdjustment.id)
          .eq("store_key", access.activeStoreKey);
        await removeAttachment(access, uploadedAttachment?.attachment_path);

        return NextResponse.json(
          { error: itemsError.message ?? "Failed to create adjustment items" },
          { status: 500 },
        );
      }
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_adjustment",
      entityId: createdAdjustment.id,
      action: "vendor_adjustment.drafted",
      summary: `Supplier adjustment drafted: ${createdAdjustment.adjustment_number}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        adjustmentNumber: createdAdjustment.adjustment_number,
        adjustmentDate,
        amount,
        inventoryImpact,
        invoiceId: linkedInvoice?.id ?? null,
      },
    });

    return NextResponse.json(
      {
        id: createdAdjustment.id,
        adjustmentNumber: createdAdjustment.adjustment_number,
        status: "draft",
        supplierId,
        supplierName: supplier.name,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Vendor adjustment creation error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create supplier adjustment",
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

    const body = (await request.json()) as {
      id?: unknown;
      status?: unknown;
    };
    const id = normalizeVendorAdjustmentText(body.id);
    const requestedStatus = normalizeVendorAdjustmentStatus(body.status);

    if (!id) {
      return NextResponse.json(
        { error: "Adjustment id is required" },
        { status: 400 },
      );
    }

    if (!["approved", "void"].includes(requestedStatus)) {
      return NextResponse.json(
        {
          error:
            "Adjustment status updates only support approve or void actions",
        },
        { status: 400 },
      );
    }

    const storedAdjustmentResult = await loadStoredAdjustment(access, id);

    if ("error" in storedAdjustmentResult) {
      return NextResponse.json(
        { error: storedAdjustmentResult.error },
        { status: storedAdjustmentResult.status },
      );
    }

    const mutationResult =
      requestedStatus === "approved"
        ? await approveAdjustment(access, storedAdjustmentResult.data)
        : await voidAdjustment(access, storedAdjustmentResult.data);

    if ("error" in mutationResult) {
      return NextResponse.json(
        { error: mutationResult.error },
        { status: mutationResult.status },
      );
    }

    return NextResponse.json({
      id,
      status: mutationResult.nextStatus,
    });
  } catch (error) {
    console.error("Vendor adjustment update error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update supplier adjustment",
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
        { error: "Adjustment id is required" },
        { status: 400 },
      );
    }

    const storedAdjustmentResult = await loadStoredAdjustment(access, id);

    if ("error" in storedAdjustmentResult) {
      return NextResponse.json(
        { error: storedAdjustmentResult.error },
        { status: storedAdjustmentResult.status },
      );
    }

    if (storedAdjustmentResult.data.status !== "draft") {
      return NextResponse.json(
        {
          error:
            "Only draft adjustments can be deleted. Approved adjustments must be voided to preserve the audit trail.",
        },
        { status: 409 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      storedAdjustmentResult.data.adjustment_date,
      `Adjustment ${storedAdjustmentResult.data.adjustment_number}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    const { error: deleteError } = await access.supabase
      .from("vendor_adjustments")
      .delete()
      .eq("id", id)
      .eq("store_key", access.activeStoreKey);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message ?? "Failed to delete adjustment" },
        { status: 500 },
      );
    }

    await removeAttachment(access, storedAdjustmentResult.data.attachment_path);

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor_adjustment",
      entityId: id,
      action: "vendor_adjustment.deleted_draft",
      summary: `Draft supplier adjustment deleted: ${storedAdjustmentResult.data.adjustment_number}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        adjustmentNumber: storedAdjustmentResult.data.adjustment_number,
        adjustmentDate: storedAdjustmentResult.data.adjustment_date,
        amount: Number(storedAdjustmentResult.data.amount ?? 0),
      },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Vendor adjustment delete error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete supplier adjustment",
      },
      { status: 500 },
    );
  }
}
