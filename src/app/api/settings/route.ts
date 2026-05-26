import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  buildStoreSettingsPayload,
  buildLegacyStoreSettingsPayload,
  createDefaultStoreSettings,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PRODUCT_TYPES,
  DEFAULT_STORE_CASH_MANAGEMENT,
  DEFAULT_STORE_LOTTERY,
  DEFAULT_STORE_PROFILE,
  initializeStoreSettingsForStore,
  isStoreSettingsTillFieldsMissing,
  isStoreSettingsTableMissing,
  loadStoreSettingsForStore,
  normalizeStoreSettings,
  STORE_SETTINGS_SELECT,
  STORE_SETTINGS_SELECT_LEGACY,
  type StoreManagementSettings,
} from "@/lib/store-settings";
import { getServerStoreContext } from "@/lib/stores/server";
import type { UserRole } from "@/types/erp.types";

async function getCurrentUserAccess(userId: string) {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role,permissions,full_name")
    .eq("id", userId)
    .single<{
      role: UserRole | null;
      permissions: string[] | null;
      full_name: string | null;
    }>();

  if (error) {
    throw error;
  }

  return {
    role: profile?.role ?? "employee",
    permissions: profile?.permissions ?? null,
    fullName: profile?.full_name ?? null,
  };
}

function buildRequestedSettings(
  body: Partial<StoreManagementSettings> | null | undefined,
) {
  return {
    source: "database",
    profile: {
      ...DEFAULT_STORE_PROFILE,
      ...(body?.profile ?? {}),
    },
    accounting: {
      closeThroughDate: body?.accounting?.closeThroughDate ?? null,
      closeNote: body?.accounting?.closeNote ?? "",
    },
    cashManagement: {
      openingFloat:
        typeof body?.cashManagement?.openingFloat === "number"
          ? body.cashManagement.openingFloat
          : DEFAULT_STORE_CASH_MANAGEMENT.openingFloat,
      closingFloat:
        typeof body?.cashManagement?.closingFloat === "number"
          ? body.cashManagement.closingFloat
          : DEFAULT_STORE_CASH_MANAGEMENT.closingFloat,
    },
    lottery: {
      cashingBonusRate:
        typeof body?.lottery?.cashingBonusRate === "number"
          ? Math.min(100, Math.max(0, body.lottery.cashingBonusRate))
          : DEFAULT_STORE_LOTTERY.cashingBonusRate,
      retailerCommissionRate:
        typeof body?.lottery?.retailerCommissionRate === "number"
          ? Math.min(100, Math.max(0, body.lottery.retailerCommissionRate))
          : DEFAULT_STORE_LOTTERY.retailerCommissionRate,
    },
    scratchCards: {
      binCount:
        typeof body?.scratchCards?.binCount === "number"
          ? Math.min(200, Math.max(1, Math.trunc(body.scratchCards.binCount)))
          : 40,
    },
    paymentMethods: Array.isArray(body?.paymentMethods)
      ? body.paymentMethods
      : DEFAULT_PAYMENT_METHODS,
    productTypes: Array.isArray(body?.productTypes)
      ? body.productTypes
      : DEFAULT_PRODUCT_TYPES,
    updatedAt: null,
  } satisfies StoreManagementSettings;
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(createDefaultStoreSettings("unconfigured"));
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await getCurrentUserAccess(user.id);

    if (
      !canAccessPath("/admin/settings", access.role, access.permissions) &&
      !canAccessPath("/sales/daily-entry", access.role, access.permissions)
    ) {
      return NextResponse.json(
        { error: "Forbidden: store settings access denied" },
        { status: 403 },
      );
    }

    const storeContext = await getServerStoreContext();

    if (!storeContext.activeStoreKey) {
      return NextResponse.json(
        { error: "Select a store before loading settings" },
        { status: 400 },
      );
    }

    const settings = await loadStoreSettingsForStore(
      supabase,
      storeContext.activeStoreKey,
    );

    if (settings.source === "fallback" && access.role === "admin") {
      const initializedSettings = await initializeStoreSettingsForStore(
        supabase,
        storeContext.activeStoreKey,
      );

      return NextResponse.json(initializedSettings);
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to load store settings" },
      { status: 500 },
    );
  }
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

    const access = await getCurrentUserAccess(user.id);

    if (!canAccessPath("/admin/settings", access.role, access.permissions)) {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 },
      );
    }

    const storeContext = await getServerStoreContext();

    if (!storeContext.activeStoreKey) {
      return NextResponse.json(
        { error: "Select a store before updating settings" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as Partial<StoreManagementSettings>;
    const requestedSettings = buildRequestedSettings(body);
    const payload = buildStoreSettingsPayload(
      requestedSettings,
      storeContext.activeStoreKey,
      user.id,
    );
    const legacyPayload = buildLegacyStoreSettingsPayload(
      requestedSettings,
      storeContext.activeStoreKey,
      user.id,
    );

    let { data, error } = await supabase
      .from("store_settings")
      .upsert(payload, { onConflict: "store_key" })
      .select(STORE_SETTINGS_SELECT)
      .single();

    if (error && isStoreSettingsTillFieldsMissing(error)) {
      ({ data, error } = await supabase
        .from("store_settings")
        .upsert(legacyPayload, { onConflict: "store_key" })
        .select(STORE_SETTINGS_SELECT_LEGACY)
        .single());
    }

    if (error) {
      if (isStoreSettingsTableMissing(error)) {
        return NextResponse.json(
          {
            error:
              "Store settings table is missing. Run the latest Supabase migration.",
          },
          { status: 503 },
        );
      }

      return NextResponse.json(
        { error: error.message ?? "Failed to update store settings" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase,
      storeKey: storeContext.activeStoreKey,
      entityType: "store_settings",
      entityId: storeContext.activeStoreKey,
      action: "settings.updated",
      summary: "Store settings updated",
      actorId: user.id,
      actorName: access.fullName ?? user.email ?? "User",
      actorRole: access.role,
      metadata: {
        hasAccountingClose: Boolean(
          requestedSettings.accounting.closeThroughDate,
        ),
        lotteryRates: requestedSettings.lottery,
        paymentMethodCount: requestedSettings.paymentMethods.length,
        salesDetailTypeCount: requestedSettings.productTypes.length,
        scratchBinCount: requestedSettings.scratchCards.binCount,
      },
    });

    return NextResponse.json(normalizeStoreSettings(data, "database"));
  } catch (error) {
    console.error("Settings PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update store settings" },
      { status: 500 },
    );
  }
}
