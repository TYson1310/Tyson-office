import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getServerStoreContext } from "@/lib/stores/server";
import type { UserRole } from "@/types/erp.types";

const ADMIN_RESET_CONFIRMATION = "RESET_STORE_DATA";
const STORE_SCOPED_RESET_TABLES = [
  "daily_sales_payment_lines",
  "daily_sales_product_lines",
  "daily_sales_summaries",
  "vendor_payments",
  "vendor_invoices",
  "expense_records",
  "daily_sales_reconciliations",
  "daily_sales_entries",
  "payroll_documents",
  "pay_statements",
  "purchase_orders",
  "sales_orders",
  "products",
  "suppliers",
];

function isAdminResetEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_ADMIN_RESET === "true"
  );
}

async function deleteStoreScopedRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  storeKey: string,
) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("store_key", storeKey);

  return error;
}

async function loadStoreScopedIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  storeKey: string,
) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("store_key", storeKey)
    .returns<Array<{ id: string }>>();

  if (error) {
    return { ids: [], error };
  }

  return {
    ids: (data ?? []).map((row) => row.id),
    error: null,
  };
}

async function deleteRowsByParentIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  parentColumn: string,
  parentIds: string[],
) {
  if (parentIds.length === 0) {
    return null;
  }

  const { error } = await supabase
    .from(table)
    .delete()
    .in(parentColumn, parentIds);

  return error;
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

    const resetErrors: string[] = [];
    const salesOrderIds = await loadStoreScopedIds(
      supabase,
      "sales_orders",
      storeContext.activeStoreKey,
    );
    const payStatementIds = await loadStoreScopedIds(
      supabase,
      "pay_statements",
      storeContext.activeStoreKey,
    );

    if (salesOrderIds.error) {
      resetErrors.push(
        `sales_orders lookup: ${salesOrderIds.error.message ?? "failed"}`,
      );
    }

    if (payStatementIds.error) {
      resetErrors.push(
        `pay_statements lookup: ${payStatementIds.error.message ?? "failed"}`,
      );
    }

    const childDeleteErrors = [
      {
        table: "sales_order_items",
        error: await deleteRowsByParentIds(
          supabase,
          "sales_order_items",
          "order_id",
          salesOrderIds.ids,
        ),
      },
      {
        table: "pay_statement_deductions",
        error: await deleteRowsByParentIds(
          supabase,
          "pay_statement_deductions",
          "pay_statement_id",
          payStatementIds.ids,
        ),
      },
    ];

    childDeleteErrors.forEach(({ table, error }) => {
      if (error) {
        resetErrors.push(`${table}: ${error.message ?? "failed"}`);
      }
    });

    for (const table of STORE_SCOPED_RESET_TABLES) {
      const error = await deleteStoreScopedRows(
        supabase,
        table,
        storeContext.activeStoreKey,
      );

      if (error) {
        resetErrors.push(`${table}: ${error.message ?? "failed"}`);
      }
    }

    if (resetErrors.length > 0) {
      console.error("Admin reset errors:", resetErrors);
      return NextResponse.json(
        {
          message: "Failed to clear all selected store data",
          errors: resetErrors,
        },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase,
      storeKey: storeContext.activeStoreKey,
      entityType: "admin_reset",
      entityId: storeContext.activeStoreKey,
      action: "admin.reset_data",
      summary: "Admin reset cleared selected store transactional data",
      actorId: user.id,
      actorName: profile?.full_name ?? user.email ?? "User",
      actorRole: profile?.role ?? "admin",
      metadata: {
        childTablesCleared: ["sales_order_items", "pay_statement_deductions"],
        storeKey: storeContext.activeStoreKey,
        tablesCleared: STORE_SCOPED_RESET_TABLES,
      },
    });

    return NextResponse.json({
      message: "Selected store transactional data cleared successfully",
    });
  } catch (error) {
    console.error("Admin Reset error:", error);
    return NextResponse.json(
      { message: "Failed to clear database" },
      { status: 500 },
    );
  }
}
