import { NextResponse } from "next/server";
import { canAccessPath } from "@/lib/auth/route-access";
import { collapseUserRole } from "@/lib/auth/shared";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getServerStoreContext } from "@/lib/stores/server";
import type { SupportedUserRole, UserRole } from "@/types/erp.types";

export const ALLOWED_PRODUCT_ROLES: SupportedUserRole[] = ["admin", "manager"];

export function canManageProductRecords(role: UserRole | null | undefined) {
  return Boolean(
    role && ALLOWED_PRODUCT_ROLES.includes(collapseUserRole(role)),
  );
}

export async function requireProductManagerAccess() {
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
    .select("role,permissions")
    .eq("id", user.id)
    .maybeSingle<{ role: UserRole | null; permissions: string[] | null }>();

  if (profileError) {
    return {
      error: NextResponse.json(
        {
          error: profileError.message ?? "Failed to verify product permissions",
        },
        { status: 500 },
      ),
    };
  }

  if (
    !canAccessPath(
      "/products/margin-engine",
      profile?.role,
      profile?.permissions,
    )
  ) {
    return {
      error: NextResponse.json(
        {
          error:
            "Forbidden: product management requires admin or manager access",
        },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before managing product records" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    currentUser: user,
    currentUserRole: collapseUserRole(profile?.role ?? "employee"),
    activeStoreKey: storeContext.activeStoreKey,
  };
}
