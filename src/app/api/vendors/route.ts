import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { requireVendorManagerAccess } from "@/lib/vendors/api";

export const runtime = "nodejs";

const ALLOWED_PAYMENT_TERMS = new Set([
  "net30",
  "net60",
  "net90",
  "cod",
  "prepaid",
]);

const ALLOWED_VENDOR_STATUSES = new Set([
  "active",
  "inactive",
  "blacklisted",
]);

type VendorMutationBody = {
  id?: unknown;
  name?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  category?: unknown;
  city?: unknown;
  paymentTerms?: unknown;
  status?: unknown;
};

type VendorRecord = {
  id: string;
  name: string;
};

type StoredVendorRecord = VendorRecord & {
  status: "active" | "inactive" | "blacklisted";
};

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: unknown) {
  const email = normalizeOptionalString(value);

  if (!email) {
    return null;
  }

  const normalized = email.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function normalizePaymentTerms(value: unknown) {
  if (typeof value !== "string") {
    return "net30";
  }

  const normalized = value.trim().toLowerCase();
  return ALLOWED_PAYMENT_TERMS.has(normalized) ? normalized : "net30";
}

function normalizeVendorStatus(value: unknown) {
  if (typeof value !== "string") {
    return "active";
  }

  const normalized = value.trim().toLowerCase();
  return ALLOWED_VENDOR_STATUSES.has(normalized) ? normalized : "active";
}

function buildVendorPayload(body: VendorMutationBody) {
  return {
    name: normalizeOptionalString(body.name),
    contact_name: normalizeOptionalString(body.contactName),
    email:
      body.email === undefined || body.email === null || body.email === ""
        ? null
        : normalizeEmail(body.email),
    phone: normalizeOptionalString(body.phone),
    category: normalizeOptionalString(body.category),
    city: normalizeOptionalString(body.city),
    payment_terms: normalizePaymentTerms(body.paymentTerms),
    status: normalizeVendorStatus(body.status),
  };
}

function validateVendorPayload(body: VendorMutationBody) {
  const payload = buildVendorPayload(body);

  if (!payload.name) {
    return { error: "Vendor name is required" };
  }

  if (
    body.email !== undefined &&
    body.email !== null &&
    body.email !== "" &&
    payload.email === null
  ) {
    return { error: "Email address is invalid" };
  }

  return { payload };
}

function getVendorId(body: VendorMutationBody) {
  return typeof body.id === "string" ? body.id.trim() : "";
}

function handleVendorWriteError(
  error: { code?: string; message?: string } | null,
  fallbackMessage: string,
) {
  const isUniqueViolation = error?.code === "23505";

  return NextResponse.json(
    {
      error: isUniqueViolation
        ? "A vendor with that email already exists"
        : (error?.message ?? fallbackMessage),
    },
    { status: isUniqueViolation ? 409 : 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as VendorMutationBody;
    const validation = validateVendorPayload(body);

    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data: insertedVendor, error: insertError } = await access.supabase
      .from("suppliers")
      .insert({
        ...validation.payload,
        store_key: access.activeStoreKey,
      })
      .select("id,name")
      .single<VendorRecord>();

    if (insertError || !insertedVendor) {
      return handleVendorWriteError(insertError, "Failed to add vendor");
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor",
      entityId: insertedVendor.id,
      action: "vendor.created",
      summary: `Vendor created: ${insertedVendor.name}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        vendorName: insertedVendor.name,
        status: validation.payload.status,
        paymentTerms: validation.payload.payment_terms,
        email: validation.payload.email,
      },
    });

    return NextResponse.json(insertedVendor, { status: 201 });
  } catch (error) {
    console.error("Vendor creation error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to add vendor",
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

    const body = (await request.json()) as VendorMutationBody;
    const id = getVendorId(body);

    if (!id) {
      return NextResponse.json({ error: "Vendor id is required" }, { status: 400 });
    }

    const validation = validateVendorPayload(body);

    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data: updatedVendor, error: updateError } = await access.supabase
      .from("suppliers")
      .update(validation.payload)
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id,name")
      .maybeSingle<VendorRecord>();

    if (updateError) {
      return handleVendorWriteError(updateError, "Failed to update vendor");
    }

    if (!updatedVendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor",
      entityId: updatedVendor.id,
      action: "vendor.updated",
      summary: `Vendor updated: ${updatedVendor.name}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        vendorName: updatedVendor.name,
        status: validation.payload.status,
        paymentTerms: validation.payload.payment_terms,
        email: validation.payload.email,
      },
    });

    return NextResponse.json(updatedVendor);
  } catch (error) {
    console.error("Vendor update error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update vendor",
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
      return NextResponse.json({ error: "Vendor id is required" }, { status: 400 });
    }

    const { data: storedVendor, error: fetchError } = await access.supabase
      .from("suppliers")
      .select("id,name,status")
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<StoredVendorRecord>();

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message ?? "Failed to load vendor" },
        { status: 500 },
      );
    }

    if (!storedVendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    if (storedVendor.status === "inactive" || storedVendor.status === "blacklisted") {
      return NextResponse.json({
        success: true,
        id: storedVendor.id,
        status: storedVendor.status,
      });
    }

    const { data: deactivatedVendor, error: updateError } = await access.supabase
      .from("suppliers")
      .update({ status: "inactive" })
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id,name,status")
      .maybeSingle<StoredVendorRecord>();

    if (updateError || !deactivatedVendor) {
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to deactivate vendor" },
        { status: updateError ? 500 : 404 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "vendor",
      entityId: deactivatedVendor.id,
      action: "vendor.inactivated",
      summary: `Vendor inactivated: ${deactivatedVendor.name}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        vendorName: deactivatedVendor.name,
        previousStatus: storedVendor.status,
        nextStatus: deactivatedVendor.status,
      },
    });

    return NextResponse.json({
      success: true,
      id: deactivatedVendor.id,
      status: deactivatedVendor.status,
    });
  } catch (error) {
    console.error("Vendor delete error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to deactivate vendor",
      },
      { status: 500 },
    );
  }
}
