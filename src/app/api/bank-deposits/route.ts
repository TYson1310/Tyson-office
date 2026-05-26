import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import {
  FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE,
  isMissingFinancialAccountabilityMigration,
} from "@/lib/accountability/financial-controls";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getServerStoreContext } from "@/lib/stores/server";
import type { UserRole } from "@/types/erp.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEPOSIT_SLIPS_BUCKET = "deposit-slips";
const MAX_DEPOSIT_SLIP_BYTES = 10 * 1024 * 1024;
const ALLOWED_DEPOSIT_SLIP_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type BankDepositInsertRow = {
  id: string;
  amount: number | string;
  deposit_date: string;
};

type BankDepositMutationRow = {
  id: string;
  amount: number | string;
  deposit_date: string;
  notes: string | null;
  status: "posted" | "void";
  void_reason: string | null;
};

function sanitizeStorageFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return extension ? `${baseName || "deposit-slip"}.${extension}` : baseName;
}

function parseAmount(value: FormDataEntryValue | null) {
  const amount = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function parseDate(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequiredText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function validateSlipFile(file: File) {
  if (file.size <= 0) {
    return "Deposit slip file is empty";
  }

  if (file.size > MAX_DEPOSIT_SLIP_BYTES) {
    return "Deposit slip must be 10MB or smaller";
  }

  if (
    file.type &&
    !ALLOWED_DEPOSIT_SLIP_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return "Upload a JPG, PNG, WEBP, or PDF deposit slip";
  }

  return null;
}

async function requireBankDepositMutationAccess() {
  if (!isSupabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: "Supabase configuration required" },
        { status: 503 },
      ),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,full_name,permissions")
    .eq("id", user.id)
    .maybeSingle<{
      role: UserRole | null;
      full_name: string | null;
      permissions: string[] | null;
    }>();

  if (profileError) {
    return {
      error: NextResponse.json(
        { error: profileError.message ?? "Failed to verify deposit access" },
        { status: 500 },
      ),
    };
  }

  if (
    !canAccessPath("/admin/bank-deposits", profile?.role, profile?.permissions)
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: bank deposit access denied" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before recording deposits" },
        { status: 400 },
      ),
    };
  }

  return {
    activeStoreKey: storeContext.activeStoreKey,
    currentUser: user,
    currentUserName: profile?.full_name ?? user.email ?? "User",
    currentUserRole: profile?.role ?? "employee",
    supabase,
  };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireBankDepositMutationAccess();

    if ("error" in access) {
      return access.error;
    }

    const formData = await request.formData();
    const amount = parseAmount(formData.get("amount"));
    const depositDate = parseDate(formData.get("depositDate"));
    const notes =
      typeof formData.get("notes") === "string"
        ? String(formData.get("notes")).trim()
        : "";
    const file = formData.get("slip");

    if (amount === null || amount <= 0) {
      return NextResponse.json(
        { error: "Deposit amount must be greater than zero" },
        { status: 400 },
      );
    }

    if (!depositDate) {
      return NextResponse.json(
        { error: "Deposit date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    if (file !== null && !(file instanceof File)) {
      return NextResponse.json(
        { error: "Deposit slip must be a file" },
        { status: 400 },
      );
    }

    if (file instanceof File) {
      const fileError = validateSlipFile(file);

      if (fileError) {
        return NextResponse.json({ error: fileError }, { status: 400 });
      }
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      depositDate,
      `Bank deposit ${depositDate}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    let slipPhotoPath: string | null = null;

    if (file instanceof File) {
      const storagePath = `${access.activeStoreKey}/${access.currentUser.id}/${depositDate}/${randomUUID()}-${sanitizeStorageFileName(file.name)}`;
      const { data, error: uploadError } = await access.supabase.storage
        .from(DEPOSIT_SLIPS_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json(
          { error: uploadError.message ?? "Failed to upload deposit slip" },
          { status: 500 },
        );
      }

      slipPhotoPath = data.path;
    }

    const { data, error } = await access.supabase
      .from("bank_deposits")
      .insert({
        amount,
        created_by: access.currentUser.id,
        deposit_date: depositDate,
        notes: notes || null,
        slip_photo_path: slipPhotoPath,
        slip_photo_url: null,
        store_key: access.activeStoreKey,
      })
      .select("id,amount,deposit_date")
      .single<BankDepositInsertRow>();

    if (error || !data) {
      if (slipPhotoPath) {
        await access.supabase.storage
          .from(DEPOSIT_SLIPS_BUCKET)
          .remove([slipPhotoPath]);
      }

      return NextResponse.json(
        { error: error?.message ?? "Failed to record bank deposit" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "bank_deposit",
      entityId: data.id,
      action: "bank_deposit.created",
      summary: `Bank deposit recorded for ${data.deposit_date}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        amount: Number(data.amount),
        depositDate: data.deposit_date,
        hasSlip: Boolean(slipPhotoPath),
        status: "posted",
      },
    });

    return NextResponse.json(
      {
        amount: Number(data.amount),
        depositDate: data.deposit_date,
        id: data.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Bank deposit POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record bank deposit",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireBankDepositMutationAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as {
      id?: unknown;
      voidReason?: unknown;
    };
    const id = normalizeId(body.id);
    const voidReason = normalizeRequiredText(body.voidReason);

    if (!id) {
      return NextResponse.json(
        { error: "Deposit id is required" },
        { status: 400 },
      );
    }

    if (!voidReason) {
      return NextResponse.json(
        { error: "Void reason is required" },
        { status: 400 },
      );
    }

    const { data: currentDeposit, error: loadError } = await access.supabase
      .from("bank_deposits")
      .select("id,amount,deposit_date,notes,status,void_reason")
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<BankDepositMutationRow>();

    if (loadError) {
      if (isMissingFinancialAccountabilityMigration(loadError)) {
        return NextResponse.json(
          { error: FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }

      return NextResponse.json(
        { error: loadError.message ?? "Failed to load bank deposit" },
        { status: 500 },
      );
    }

    if (!currentDeposit) {
      return NextResponse.json(
        { error: "Bank deposit not found" },
        { status: 404 },
      );
    }

    if (currentDeposit.status === "void") {
      return NextResponse.json(
        { error: "Bank deposit is already void" },
        { status: 409 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      currentDeposit.deposit_date,
      `Bank deposit ${currentDeposit.deposit_date}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    const voidedAt = new Date().toISOString();
    const { data, error } = await access.supabase
      .from("bank_deposits")
      .update({
        status: "void",
        void_reason: voidReason,
        voided_at: voidedAt,
        voided_by: access.currentUser.id,
      })
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id,amount,deposit_date,notes,status,void_reason")
      .single<BankDepositMutationRow>();

    if (error || !data) {
      if (isMissingFinancialAccountabilityMigration(error)) {
        return NextResponse.json(
          { error: FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }

      return NextResponse.json(
        { error: error?.message ?? "Failed to void bank deposit" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "bank_deposit",
      entityId: data.id,
      action: "bank_deposit.voided",
      summary: `Bank deposit voided for ${data.deposit_date}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        amount: Number(data.amount),
        depositDate: data.deposit_date,
        previousStatus: currentDeposit.status,
        status: data.status,
        voidReason,
      },
    });

    return NextResponse.json({
      amount: Number(data.amount),
      depositDate: data.deposit_date,
      id: data.id,
      status: data.status,
      voidReason: data.void_reason,
    });
  } catch (error) {
    console.error("Bank deposit PATCH error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update bank deposit",
      },
      { status: 500 },
    );
  }
}
