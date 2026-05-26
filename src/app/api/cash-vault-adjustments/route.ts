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

type CashVaultAdjustmentType = "opening_balance" | "manual_adjustment";

type CashVaultAdjustmentRow = {
  id: string;
  adjustment_date: string;
  adjustment_type: CashVaultAdjustmentType;
  amount: number | string;
  reason: string;
  reference_number: string | null;
};

function normalizeAmount(value: unknown) {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount === 0) {
    return null;
  }

  return Math.round(amount * 100) / 100;
}

function normalizeDate(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeText(value: unknown, required = false) {
  if (typeof value !== "string") {
    return required ? null : "";
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return required && normalized.length === 0 ? null : normalized;
}

function normalizeAdjustmentType(
  value: unknown,
): CashVaultAdjustmentType | null {
  return value === "opening_balance" || value === "manual_adjustment"
    ? value
    : null;
}

async function requireCashVaultAdjustmentAccess() {
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
        {
          error:
            profileError.message ?? "Failed to verify cash adjustment access",
        },
        { status: 500 },
      ),
    };
  }

  if (
    !canAccessPath("/admin/bank-deposits", profile?.role, profile?.permissions)
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: cash vault access denied" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before adjusting cash" },
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
    const access = await requireCashVaultAdjustmentAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as {
      adjustmentDate?: unknown;
      adjustmentType?: unknown;
      amount?: unknown;
      reason?: unknown;
      referenceNumber?: unknown;
    };
    const adjustmentType = normalizeAdjustmentType(body.adjustmentType);
    const adjustmentDate = normalizeDate(body.adjustmentDate);
    const amount = normalizeAmount(body.amount);
    const reason = normalizeText(body.reason, true);
    const referenceNumber = normalizeText(body.referenceNumber) || null;

    if (!adjustmentType) {
      return NextResponse.json(
        { error: "Adjustment type is required" },
        { status: 400 },
      );
    }

    if (!adjustmentDate) {
      return NextResponse.json(
        { error: "Adjustment date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    if (amount === null) {
      return NextResponse.json(
        { error: "Adjustment amount must be a non-zero number" },
        { status: 400 },
      );
    }

    if (!reason) {
      return NextResponse.json(
        { error: "Adjustment reason is required" },
        { status: 400 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      adjustmentDate,
      `Cash vault adjustment ${adjustmentDate}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    const { data, error } = await access.supabase
      .from("cash_vault_adjustments")
      .insert({
        adjustment_date: adjustmentDate,
        adjustment_type: adjustmentType,
        amount,
        created_by: access.currentUser.id,
        reason,
        reference_number: referenceNumber,
        store_key: access.activeStoreKey,
      })
      .select(
        "id,adjustment_date,adjustment_type,amount,reason,reference_number",
      )
      .single<CashVaultAdjustmentRow>();

    if (error || !data) {
      if (isMissingFinancialAccountabilityMigration(error)) {
        return NextResponse.json(
          { error: FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }

      return NextResponse.json(
        { error: error?.message ?? "Failed to record cash adjustment" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "cash_vault_adjustment",
      entityId: data.id,
      action: "cash_vault.adjustment_created",
      summary:
        data.adjustment_type === "opening_balance"
          ? `Opening cash balance recorded for ${data.adjustment_date}`
          : `Cash vault adjustment recorded for ${data.adjustment_date}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        adjustmentDate: data.adjustment_date,
        adjustmentType: data.adjustment_type,
        amount: Number(data.amount),
        reason: data.reason,
        referenceNumber: data.reference_number,
      },
    });

    return NextResponse.json(
      {
        adjustmentDate: data.adjustment_date,
        adjustmentType: data.adjustment_type,
        amount: Number(data.amount),
        id: data.id,
        reason: data.reason,
        referenceNumber: data.reference_number,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Cash vault adjustment POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record cash adjustment",
      },
      { status: 500 },
    );
  }
}
