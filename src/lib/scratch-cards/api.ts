import { NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { canAccessPath } from "@/lib/auth/route-access";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getServerStoreContext } from "@/lib/stores/server";
import type { UserRole } from "@/types/erp.types";
import { ScratchCardWorkflowError } from "./workflows";

type ScratchCardRole = Extract<
  UserRole,
  "accountant" | "admin" | "manager" | "cashier" | "employee"
>;

export type ScratchCardAccess = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  currentUser: NonNullable<
    Awaited<ReturnType<typeof getUserSafely>>["data"]["user"]
  >;
  currentUserRole: UserRole;
  activeStoreKey: string;
  activeStoreTimeZone: string;
};

export async function requireScratchCardAccess(
  allowedRoles: ScratchCardRole[],
  accessPath = "/scratch-cards/audit",
) {
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
          error: profileError.message ?? "Failed to verify scratch card access",
        },
        { status: 500 },
      ),
    };
  }

  const currentUserRole = profile?.role ?? "employee";

  if (
    !allowedRoles.includes(currentUserRole as ScratchCardRole) ||
    !canAccessPath(accessPath, currentUserRole, profile?.permissions)
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: scratch card access denied" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before using scratch card workflows" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    currentUser: user,
    currentUserRole,
    activeStoreKey: storeContext.activeStoreKey,
    activeStoreTimeZone: storeContext.activeStore?.timeZone ?? "UTC",
  } satisfies ScratchCardAccess;
}

export function scratchCardErrorResponse(
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof ScratchCardWorkflowError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;

  return NextResponse.json({ error: message }, { status: 500 });
}

export async function requireOpenAccountingPeriod(
  access: ScratchCardAccess,
  entryDate: unknown,
  label: string,
) {
  const effectiveDate =
    typeof entryDate === "string" && entryDate.trim()
      ? entryDate.trim()
      : getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
  const periodLock = await assertAccountingPeriodUnlocked(
    access.supabase,
    access.activeStoreKey,
    effectiveDate,
    label,
  );

  if (!periodLock) {
    return null;
  }

  return NextResponse.json(
    { error: periodLock.error },
    { status: periodLock.status },
  );
}
