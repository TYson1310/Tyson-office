import { NextRequest, NextResponse } from "next/server";
import { canAccessAnyProtectedPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getServerStoreContext } from "@/lib/stores/server";
import {
  ACTIVE_STORE_COOKIE,
  DEFAULT_STORE_SUMMARY,
  normalizeStoreKey,
} from "@/lib/stores/shared";
import type { UserRole } from "@/types/erp.types";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function applyStoreCookie(response: NextResponse, storeKey?: string | null) {
  if (!storeKey) {
    response.cookies.delete(ACTIVE_STORE_COOKIE);
    return response;
  }

  response.cookies.set(ACTIVE_STORE_COOKIE, storeKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}

function serializeContext(
  context: Awaited<ReturnType<typeof getServerStoreContext>>,
) {
  return {
    activeStore: context.activeStore,
    accessibleStores: context.accessibleStores,
    isAdmin: context.isAdmin,
    needsSelection: context.needsSelection,
  };
}

async function verifyStoreContextAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role,permissions")
    .eq("id", userId)
    .maybeSingle<{ role: UserRole | null; permissions: string[] | null }>();

  if (error) {
    return {
      error: NextResponse.json(
        { error: error.message ?? "Failed to verify store access" },
        { status: 500 },
      ),
    };
  }

  if (!canAccessAnyProtectedPath(profile?.role, profile?.permissions)) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: app access denied" },
        { status: 403 },
      ),
    };
  }

  return { error: null };
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return applyStoreCookie(
        NextResponse.json({
          activeStore: DEFAULT_STORE_SUMMARY,
          accessibleStores: [DEFAULT_STORE_SUMMARY],
          isAdmin: false,
          needsSelection: false,
        }),
        DEFAULT_STORE_SUMMARY.storeKey,
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await getUserSafely(supabase);

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await verifyStoreContextAccess(supabase, user.id);

    if (access.error) {
      return access.error;
    }

    const context = await getServerStoreContext();
    return applyStoreCookie(
      NextResponse.json(serializeContext(context)),
      context.activeStoreKey,
    );
  } catch (error) {
    console.error("Store context GET error:", error);
    return NextResponse.json(
      { error: "Failed to load store context" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return applyStoreCookie(
        NextResponse.json({
          activeStore: DEFAULT_STORE_SUMMARY,
          accessibleStores: [DEFAULT_STORE_SUMMARY],
          isAdmin: false,
          needsSelection: false,
        }),
        DEFAULT_STORE_SUMMARY.storeKey,
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await getUserSafely(supabase);

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await verifyStoreContextAccess(supabase, user.id);

    if (access.error) {
      return access.error;
    }

    const body = (await request.json()) as { storeKey?: unknown };
    const requestedStoreKey = normalizeStoreKey(
      typeof body.storeKey === "string" ? body.storeKey : null,
    );

    if (!requestedStoreKey) {
      return NextResponse.json(
        { error: "Store selection is required" },
        { status: 400 },
      );
    }

    const context = await getServerStoreContext();
    const requestedStore = context.accessibleStores.find(
      (store) => store.storeKey === requestedStoreKey,
    );

    if (!requestedStore) {
      return NextResponse.json(
        { error: "Store is not accessible" },
        { status: 403 },
      );
    }

    return applyStoreCookie(
      NextResponse.json({
        activeStore: requestedStore,
        accessibleStores: context.accessibleStores,
        isAdmin: context.isAdmin,
        needsSelection: false,
      }),
      requestedStore.storeKey,
    );
  } catch (error) {
    console.error("Store context POST error:", error);
    return NextResponse.json(
      { error: "Failed to select store" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  return applyStoreCookie(NextResponse.json({ success: true }), null);
}
