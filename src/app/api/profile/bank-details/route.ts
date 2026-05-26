import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { UserRole } from "@/types/erp.types";

type BankProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole | null;
  permissions: string[] | null;
  store_key: string | null;
  bank_name: string | null;
  bank_account_last4: string | null;
};

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeAccountNumber(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\D/g, "");
}

export async function PATCH(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase configuration required" },
        { status: 503 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      bankName?: unknown;
      accountNumber?: unknown;
      clear?: unknown;
    };
    const bankName = normalizeOptionalString(body.bankName);
    const accountNumber = normalizeAccountNumber(body.accountNumber);
    const clearRequested = body.clear === true;

    const { data: currentProfile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id,full_name,role,permissions,store_key,bank_name,bank_account_last4",
      )
      .eq("id", user.id)
      .maybeSingle<BankProfileRow>();

    if (profileError || !currentProfile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found" },
        { status: profileError ? 500 : 404 },
      );
    }

    if (
      !canAccessPath(
        "/employee/profile",
        currentProfile.role,
        currentProfile.permissions,
      )
    ) {
      return NextResponse.json(
        { error: "Forbidden: profile access denied" },
        { status: 403 },
      );
    }

    if (clearRequested) {
      const { data, error } = await supabase
        .from("profiles")
        .update({
          bank_name: null,
          bank_account_last4: null,
        })
        .eq("id", user.id)
        .select("bank_name,bank_account_last4")
        .maybeSingle<
          Pick<BankProfileRow, "bank_name" | "bank_account_last4">
        >();

      if (error || !data) {
        return NextResponse.json(
          { error: error?.message ?? "Failed to clear bank details" },
          { status: 500 },
        );
      }

      if (currentProfile.store_key) {
        await appendAuditEvent({
          supabase,
          storeKey: currentProfile.store_key,
          entityType: "employee_bank_details",
          entityId: user.id,
          action: "profile.bank_details_cleared",
          summary: "Employee bank details cleared",
          actorId: user.id,
          actorName: currentProfile.full_name ?? user.email ?? "User",
          actorRole: currentProfile.role ?? "employee",
          metadata: {
            hadBankName: Boolean(currentProfile.bank_name),
            hadLast4: Boolean(currentProfile.bank_account_last4),
          },
        });
      }

      return NextResponse.json({
        bankName: data.bank_name,
        bankAccountLast4: data.bank_account_last4,
      });
    }

    if (!bankName) {
      return NextResponse.json(
        { error: "Bank name is required" },
        { status: 400 },
      );
    }

    if (!accountNumber && !currentProfile.bank_account_last4) {
      return NextResponse.json(
        { error: "Account number is required" },
        { status: 400 },
      );
    }

    if (accountNumber && accountNumber.length < 4) {
      return NextResponse.json(
        { error: "Account number must contain at least 4 digits" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({
        bank_name: bankName,
        bank_account_last4: accountNumber
          ? accountNumber.slice(-4)
          : currentProfile.bank_account_last4,
      })
      .eq("id", user.id)
      .select("bank_name,bank_account_last4")
      .maybeSingle<Pick<BankProfileRow, "bank_name" | "bank_account_last4">>();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update bank details" },
        { status: 500 },
      );
    }

    if (currentProfile.store_key) {
      await appendAuditEvent({
        supabase,
        storeKey: currentProfile.store_key,
        entityType: "employee_bank_details",
        entityId: user.id,
        action: "profile.bank_details_updated",
        summary: "Employee bank details updated",
        actorId: user.id,
        actorName: currentProfile.full_name ?? user.email ?? "User",
        actorRole: currentProfile.role ?? "employee",
        metadata: {
          bankNameChanged: data.bank_name !== currentProfile.bank_name,
          last4Changed:
            data.bank_account_last4 !== currentProfile.bank_account_last4,
          newLast4: data.bank_account_last4,
        },
      });
    }

    return NextResponse.json({
      bankName: data.bank_name,
      bankAccountLast4: data.bank_account_last4,
    });
  } catch (error) {
    console.error("Bank details PATCH error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update bank details",
      },
      { status: 500 },
    );
  }
}
