import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getServerStoreContext } from "@/lib/stores/server";
import type { UserRole } from "@/types/erp.types";

const ADMIN_RESET_CONFIRMATION = "RESET_STORE_DATA";

function isAdminResetEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_ADMIN_RESET === "true"
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!isAdminResetEnabled()) {
      return NextResponse.json(
        { message: "Admin reset is disabled in this environment" },
        { status: 404 },
      );
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { message: "Supabase configuration required" },
        { status: 503 },
      );
    }

    const supabase = await createClient();

    // Check authentication and admin role
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role,permissions,full_name")
      .eq("id", user.id)
      .single<{
        role: UserRole | null;
        permissions: string[] | null;
        full_name: string | null;
      }>();

    if (
      !canAccessPath("/admin/settings", profile?.role, profile?.permissions)
    ) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      confirmation?: unknown;
    } | null;

    if (body?.confirmation !== ADMIN_RESET_CONFIRMATION) {
      return NextResponse.json(
        { message: `Confirmation must be ${ADMIN_RESET_CONFIRMATION}` },
        { status: 400 },
      );
    }

    const storeContext = await getServerStoreContext();

    if (!storeContext.activeStoreKey) {
      return NextResponse.json(
        { message: "Select a store before resetting data" },
        { status: 400 },
      );
    }

    // List of tables to clear in correct order (child tables first to avoid FK violations)
    const tablesToClear = [
      "daily_sales_payment_lines",
      "daily_sales_product_lines",
      "daily_sales_summaries",
      "sales_order_items",
      "sales_orders",
      "purchase_orders",
      "vendor_payments",
      "vendor_invoices",
      "expense_records",
      "daily_sales_reconciliations",
      "daily_sales_entries",
      "pay_statement_deductions",
      "pay_statements",
      "payroll_documents",
      "products",
      "suppliers",
    ];

    for (const table of tablesToClear) {
      const { error } = await supabase
        .from(table)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        console.error(`Error clearing table ${table}:`, error);
      }
    }

    // Clear non-admin profiles
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .neq("role", "admin");

    if (profileError) {
      console.error("Error clearing non-admin profiles:", profileError);
    }

    await appendAuditEvent({
      supabase,
      storeKey: storeContext.activeStoreKey,
      entityType: "admin_reset",
      entityId: storeContext.activeStoreKey,
      action: "admin.reset_data",
      summary: "Admin reset cleared transactional and employee data",
      actorId: user.id,
      actorName: profile?.full_name ?? user.email ?? "User",
      actorRole: profile?.role ?? "admin",
      metadata: {
        tablesCleared: tablesToClear,
      },
    });

    return NextResponse.json({
      message: "All transactional and employee data cleared successfully",
    });
  } catch (error) {
    console.error("Admin Reset error:", error);
    return NextResponse.json(
      { message: "Failed to clear database" },
      { status: 500 },
    );
  }
}
