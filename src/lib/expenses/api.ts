import { NextResponse } from "next/server";
import { canAccessPath } from "@/lib/auth/route-access";
import { collapseUserRole } from "@/lib/auth/shared";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getServerStoreContext } from "@/lib/stores/server";
import type { SupportedUserRole, UserRole } from "@/types/erp.types";

export const ALLOWED_EXPENSE_ROLES: SupportedUserRole[] = ["admin", "manager"];

export function canManageExpenseRecords(role: UserRole | null | undefined) {
  return Boolean(
    role && ALLOWED_EXPENSE_ROLES.includes(collapseUserRole(role)),
  );
}

type ExpenseAccessContext = Exclude<
  Awaited<ReturnType<typeof requireExpenseManagerAccess>>,
  { error: NextResponse }
>;

export async function validateExpenseSupplierId(
  supplierId: string | null,
  access: ExpenseAccessContext,
) {
  if (!supplierId) {
    return { supplierId, supplierName: null };
  }

  const { data, error } = await access.supabase
    .from("suppliers")
    .select("id,name")
    .eq("id", supplierId)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<{ id: string; name: string }>();

  if (error) {
    return {
      error: NextResponse.json(
        { error: error.message ?? "Failed to validate vendor" },
        { status: 500 },
      ),
    };
  }

  if (!data) {
    return {
      error: NextResponse.json(
        { error: "Selected vendor was not found for this store" },
        { status: 400 },
      ),
    };
  }

  return { supplierId: data.id, supplierName: data.name };
}

export async function requireExpenseManagerAccess() {
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
          error: profileError.message ?? "Failed to verify expense permissions",
        },
        { status: 500 },
      ),
    };
  }

  if (!canAccessPath("/admin/expenses", profile?.role, profile?.permissions)) {
    return {
      error: NextResponse.json(
        {
          error:
            "Forbidden: expense management requires admin or manager access",
        },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before managing expenses" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    currentUser: user,
    currentUserRole: collapseUserRole(profile?.role ?? "employee"),
    currentUserName: profile?.full_name ?? user.email ?? "User",
    activeStoreKey: storeContext.activeStoreKey,
    activeStoreTimeZone: storeContext.activeStore?.timeZone ?? "UTC",
  };
}
