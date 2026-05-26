import { NextRequest, NextResponse } from "next/server";
import {
  appendPrivateAdminAuditEvent,
  requirePrivateAdminSession,
} from "@/lib/private-admin-portal";
import { BRAND } from "@/lib/brand";
import { isValidTimeZone } from "@/lib/date-time";
import {
  DEFAULT_STORE_CASH_MANAGEMENT,
  DEFAULT_STORE_LOTTERY,
  DEFAULT_STORE_SCRATCH_CARDS,
  isStoreSettingsTableMissing,
} from "@/lib/store-settings";
import {
  DEFAULT_STORE_KEY,
  type StoreStatus,
  normalizeStoreKey,
} from "@/lib/stores/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

type Params = Promise<{ token: string }>;

type StoreRow = {
  store_key: string;
  name: string;
  status: StoreStatus;
  created_at: string;
  updated_at: string;
};

type StoreRecord = {
  storeKey: string;
  name: string;
  status: StoreStatus;
  timeZone: string;
  openingFloat: number;
  closingFloat: number;
  scratchBinCount: number;
  lotteryRetailerCommissionRate: number;
  lotteryCashingBonusRate: number;
  createdAt: string;
  updatedAt: string;
};

const STORE_SELECT = "store_key,name,status,created_at,updated_at";
const STORE_SETTINGS_SELECT =
  "store_key,timezone_name,till_opening_float,till_closing_float,scratch_bin_count,lottery_retailer_commission_rate,lottery_cashing_bonus_rate";
const STORE_SETTINGS_SELECT_LEGACY = "store_key,timezone_name";
const DEFAULT_TIME_ZONE: string = BRAND.defaultBusinessProfile.timezone;

type StoreSettingsRow = {
  store_key: string;
  timezone_name: string | null;
  till_opening_float?: number | string | null;
  till_closing_float?: number | string | null;
  scratch_bin_count?: number | string | null;
  lottery_retailer_commission_rate?: number | string | null;
  lottery_cashing_bonus_rate?: number | string | null;
};

type StoreProfileRow = {
  email: string | null;
  id: string;
};

type StoreDeleteRpcRow = {
  deleted_store_key: string;
  deleted_table_count: number;
};

function normalizeStatus(status: unknown): StoreStatus {
  if (status === "inactive") {
    return "inactive";
  }

  return "active";
}

function buildStoreName(body: Record<string, unknown>) {
  const name =
    typeof body.name === "string"
      ? body.name
      : typeof body.storeName === "string"
        ? body.storeName
        : "";

  return name.trim();
}

function readTimeZone(body: Record<string, unknown>) {
  if (typeof body.timeZone === "string") {
    return body.timeZone.trim();
  }

  if (typeof body.timezone === "string") {
    return body.timezone.trim();
  }

  return "";
}

function normalizeTimeZone(value: string) {
  if (!value) {
    return DEFAULT_TIME_ZONE;
  }

  if (!isValidTimeZone(value)) {
    return null;
  }

  return value;
}

function normalizeFloatValue(value: unknown, fallback: number) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function readOptionalNumber(
  body: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in body) {
      return body[key];
    }
  }

  return undefined;
}

function parseTillFloat(value: unknown) {
  if (value === undefined) {
    return { provided: false, value: null as number | null };
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return { provided: true, value: null as number | null };
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return { provided: true, value: null as number | null };
  }

  return { provided: true, value: normalized };
}

function parseScratchBinCount(value: unknown) {
  if (value === undefined) {
    return { provided: false, value: null as number | null };
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return { provided: true, value: null as number | null };
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 200) {
    return { provided: true, value: null as number | null };
  }

  return { provided: true, value: normalized };
}

function parsePercentValue(value: unknown) {
  if (value === undefined) {
    return { provided: false, value: null as number | null };
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return { provided: true, value: null as number | null };
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    return { provided: true, value: null as number | null };
  }

  return { provided: true, value: Math.round(normalized * 100) / 100 };
}

function isStoreSettingsTillFieldsMissing(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("till_opening_float") ||
    message.includes("till_closing_float") ||
    message.includes("scratch_bin_count") ||
    message.includes("lottery_retailer_commission_rate") ||
    message.includes("lottery_cashing_bonus_rate")
  );
}

function mapStore(
  row: StoreRow,
  input: {
    timeZone?: string;
    openingFloat?: number;
    closingFloat?: number;
    scratchBinCount?: number;
    lotteryRetailerCommissionRate?: number;
    lotteryCashingBonusRate?: number;
  } = {},
): StoreRecord {
  return {
    storeKey: row.store_key,
    name: row.name,
    status: row.status,
    timeZone: input.timeZone ?? DEFAULT_TIME_ZONE,
    openingFloat:
      input.openingFloat ?? DEFAULT_STORE_CASH_MANAGEMENT.openingFloat,
    closingFloat:
      input.closingFloat ?? DEFAULT_STORE_CASH_MANAGEMENT.closingFloat,
    scratchBinCount:
      input.scratchBinCount ?? DEFAULT_STORE_SCRATCH_CARDS.binCount,
    lotteryRetailerCommissionRate:
      input.lotteryRetailerCommissionRate ??
      DEFAULT_STORE_LOTTERY.retailerCommissionRate,
    lotteryCashingBonusRate:
      input.lotteryCashingBonusRate ?? DEFAULT_STORE_LOTTERY.cashingBonusRate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getConfigurationError() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase configuration required" },
      { status: 503 },
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for store management" },
      { status: 503 },
    );
  }

  return null;
}

async function getAuthorizedAdminClient(token: string) {
  const configurationError = getConfigurationError();

  if (configurationError) {
    return { error: configurationError };
  }

  const access = await requirePrivateAdminSession(token);

  if (access.error) {
    return { error: access.error };
  }

  return { adminClient: createAdminClient() };
}

async function getStore(
  storeKey: string,
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await adminClient
    .from("stores")
    .select(STORE_SELECT)
    .eq("store_key", storeKey)
    .maybeSingle<StoreRow>();

  if (error || !data) {
    return {
      error: NextResponse.json({ error: "Store not found" }, { status: 404 }),
    };
  }

  return { data };
}

async function loadStoreTimeZoneMap(
  adminClient: ReturnType<typeof createAdminClient>,
  storeKeys: string[],
) {
  if (storeKeys.length === 0) {
    return new Map<
      string,
      {
        timeZone: string;
        openingFloat: number;
        closingFloat: number;
        scratchBinCount: number;
        lotteryRetailerCommissionRate: number;
        lotteryCashingBonusRate: number;
      }
    >();
  }

  let { data, error } = await adminClient
    .from("store_settings")
    .select(STORE_SETTINGS_SELECT)
    .in("store_key", storeKeys)
    .returns<StoreSettingsRow[]>();

  if (error && isStoreSettingsTillFieldsMissing(error)) {
    ({ data, error } = await adminClient
      .from("store_settings")
      .select(STORE_SETTINGS_SELECT_LEGACY)
      .in("store_key", storeKeys)
      .returns<StoreSettingsRow[]>());
  }

  if (error) {
    if (isStoreSettingsTableMissing(error)) {
      return new Map<
        string,
        {
          timeZone: string;
          openingFloat: number;
          closingFloat: number;
          scratchBinCount: number;
          lotteryRetailerCommissionRate: number;
          lotteryCashingBonusRate: number;
        }
      >();
    }

    throw error;
  }

  return new Map(
    (data ?? []).map((row) => [
      row.store_key,
      {
        timeZone: row.timezone_name?.trim() || DEFAULT_TIME_ZONE,
        openingFloat: normalizeFloatValue(
          row.till_opening_float,
          DEFAULT_STORE_CASH_MANAGEMENT.openingFloat,
        ),
        closingFloat: normalizeFloatValue(
          row.till_closing_float,
          DEFAULT_STORE_CASH_MANAGEMENT.closingFloat,
        ),
        scratchBinCount: Math.trunc(
          normalizeFloatValue(
            row.scratch_bin_count,
            DEFAULT_STORE_SCRATCH_CARDS.binCount,
          ),
        ),
        lotteryRetailerCommissionRate: normalizeFloatValue(
          row.lottery_retailer_commission_rate,
          DEFAULT_STORE_LOTTERY.retailerCommissionRate,
        ),
        lotteryCashingBonusRate: normalizeFloatValue(
          row.lottery_cashing_bonus_rate,
          DEFAULT_STORE_LOTTERY.cashingBonusRate,
        ),
      },
    ]),
  );
}

async function buildStoreRecord(
  adminClient: ReturnType<typeof createAdminClient>,
  row: StoreRow,
) {
  const timeZoneMap = await loadStoreTimeZoneMap(adminClient, [row.store_key]);
  return mapStore(row, timeZoneMap.get(row.store_key));
}

async function saveStoreSettings(
  adminClient: ReturnType<typeof createAdminClient>,
  storeKey: string,
  input: {
    timeZone: string;
    openingFloat: number;
    closingFloat: number;
    scratchBinCount: number;
    lotteryRetailerCommissionRate: number;
    lotteryCashingBonusRate: number;
  },
) {
  let { error } = await adminClient.from("store_settings").upsert(
    {
      store_key: storeKey,
      timezone_name: input.timeZone,
      till_opening_float: input.openingFloat,
      till_closing_float: input.closingFloat,
      scratch_bin_count: input.scratchBinCount,
      lottery_retailer_commission_rate: input.lotteryRetailerCommissionRate,
      lottery_cashing_bonus_rate: input.lotteryCashingBonusRate,
    },
    { onConflict: "store_key" },
  );

  if (error && isStoreSettingsTillFieldsMissing(error)) {
    ({ error } = await adminClient.from("store_settings").upsert(
      {
        store_key: storeKey,
        timezone_name: input.timeZone,
      },
      { onConflict: "store_key" },
    ));
  }

  if (error && !isStoreSettingsTableMissing(error)) {
    throw error;
  }
}

function getDuplicateStoreError(message?: string | null) {
  const normalizedMessage = message?.toLowerCase() ?? "";

  if (
    normalizedMessage.includes("duplicate") ||
    normalizedMessage.includes("already exists") ||
    normalizedMessage.includes("unique constraint")
  ) {
    return NextResponse.json(
      { error: "A store with that key already exists" },
      { status: 409 },
    );
  }

  return null;
}

function getRpcStoreDeleteStatus(error: {
  code?: string | null;
  message?: string | null;
}) {
  if (error.code === "P0002") {
    return 404;
  }

  if (error.code === "22023") {
    return 400;
  }

  if (error.code === "23503") {
    return 409;
  }

  return 500;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const { data, error } = await access.adminClient
      .from("stores")
      .select(STORE_SELECT)
      .order("name", { ascending: true })
      .returns<StoreRow[]>();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to fetch stores" },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const timeZoneMap = await loadStoreTimeZoneMap(
      access.adminClient,
      rows.map((row) => row.store_key),
    );

    return NextResponse.json(
      rows.map((row) => mapStore(row, timeZoneMap.get(row.store_key))),
    );
  } catch (error) {
    console.error("Private admin stores GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stores" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const storeKey = normalizeStoreKey(
      typeof body.storeKey === "string"
        ? body.storeKey
        : typeof body.key === "string"
          ? body.key
          : null,
    );
    const name = buildStoreName(body);
    const normalizedTimeZone = normalizeTimeZone(readTimeZone(body));
    const openingFloat = parseTillFloat(
      readOptionalNumber(body, ["openingFloat", "tillOpeningFloat"]),
    );
    const closingFloat = parseTillFloat(
      readOptionalNumber(body, ["closingFloat", "tillClosingFloat"]),
    );
    const scratchBinCount = parseScratchBinCount(
      readOptionalNumber(body, ["scratchBinCount", "scratch_bin_count"]),
    );
    const lotteryRetailerCommissionRate = parsePercentValue(
      readOptionalNumber(body, [
        "lotteryRetailerCommissionRate",
        "retailerCommissionRate",
        "lottery_retailer_commission_rate",
      ]),
    );
    const lotteryCashingBonusRate = parsePercentValue(
      readOptionalNumber(body, [
        "lotteryCashingBonusRate",
        "cashingBonusRate",
        "lottery_cashing_bonus_rate",
      ]),
    );

    if (!storeKey || !name) {
      return NextResponse.json(
        { error: "Missing required fields: storeKey and name" },
        { status: 400 },
      );
    }

    if (!normalizedTimeZone) {
      return NextResponse.json(
        {
          error: "Invalid timezone. Use an IANA timezone like America/New_York",
        },
        { status: 400 },
      );
    }

    if (
      !openingFloat.provided ||
      !closingFloat.provided ||
      !scratchBinCount.provided ||
      openingFloat.value === null ||
      closingFloat.value === null ||
      scratchBinCount.value === null
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required store setup fields: openingFloat, closingFloat, and scratchBinCount",
        },
        { status: 400 },
      );
    }

    if (
      (lotteryRetailerCommissionRate.provided &&
        lotteryRetailerCommissionRate.value === null) ||
      (lotteryCashingBonusRate.provided &&
        lotteryCashingBonusRate.value === null)
    ) {
      return NextResponse.json(
        { error: "Lottery EFT rates must be percentages between 0 and 100" },
        { status: 400 },
      );
    }

    const { data, error } = await access.adminClient
      .from("stores")
      .insert({
        store_key: storeKey,
        name,
        status: normalizeStatus(body.status),
      })
      .select(STORE_SELECT)
      .returns<StoreRow[]>()
      .single();

    if (error || !data) {
      const duplicateError = getDuplicateStoreError(error?.message);

      if (duplicateError) {
        return duplicateError;
      }

      return NextResponse.json(
        { error: error?.message ?? "Failed to create store" },
        { status: 500 },
      );
    }

    await saveStoreSettings(access.adminClient, storeKey, {
      timeZone: normalizedTimeZone,
      openingFloat: openingFloat.value,
      closingFloat: closingFloat.value,
      scratchBinCount: scratchBinCount.value,
      lotteryRetailerCommissionRate:
        lotteryRetailerCommissionRate.value ??
        DEFAULT_STORE_LOTTERY.retailerCommissionRate,
      lotteryCashingBonusRate:
        lotteryCashingBonusRate.value ?? DEFAULT_STORE_LOTTERY.cashingBonusRate,
    });

    const store = await buildStoreRecord(access.adminClient, data);

    await appendPrivateAdminAuditEvent({
      action: "private_admin.store_created",
      metadata: {
        closingFloat: closingFloat.value,
        name,
        openingFloat: openingFloat.value,
        scratchBinCount: scratchBinCount.value,
        status: data.status,
        timeZone: normalizedTimeZone,
      },
      request,
      result: "success",
      targetId: storeKey,
      targetStoreKey: storeKey,
      targetType: "store",
      token,
    });

    return NextResponse.json({ store }, { status: 201 });
  } catch (error) {
    console.error("Private admin stores POST error:", error);
    return NextResponse.json(
      { error: "Failed to create store" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const storeKey = normalizeStoreKey(
      typeof body.storeKey === "string"
        ? body.storeKey
        : typeof body.key === "string"
          ? body.key
          : null,
    );

    if (!storeKey) {
      return NextResponse.json(
        { error: "Missing required field: storeKey" },
        { status: 400 },
      );
    }

    const rawTimeZone = readTimeZone(body);
    const normalizedTimeZone = normalizeTimeZone(rawTimeZone);
    const openingFloat = parseTillFloat(
      readOptionalNumber(body, ["openingFloat", "tillOpeningFloat"]),
    );
    const closingFloat = parseTillFloat(
      readOptionalNumber(body, ["closingFloat", "tillClosingFloat"]),
    );
    const scratchBinCount = parseScratchBinCount(
      readOptionalNumber(body, ["scratchBinCount", "scratch_bin_count"]),
    );
    const lotteryRetailerCommissionRate = parsePercentValue(
      readOptionalNumber(body, [
        "lotteryRetailerCommissionRate",
        "retailerCommissionRate",
        "lottery_retailer_commission_rate",
      ]),
    );
    const lotteryCashingBonusRate = parsePercentValue(
      readOptionalNumber(body, [
        "lotteryCashingBonusRate",
        "cashingBonusRate",
        "lottery_cashing_bonus_rate",
      ]),
    );

    if (rawTimeZone && !normalizedTimeZone) {
      return NextResponse.json(
        {
          error: "Invalid timezone. Use an IANA timezone like America/New_York",
        },
        { status: 400 },
      );
    }

    if (
      (openingFloat.provided && openingFloat.value === null) ||
      (closingFloat.provided && closingFloat.value === null) ||
      (scratchBinCount.provided && scratchBinCount.value === null) ||
      (lotteryRetailerCommissionRate.provided &&
        lotteryRetailerCommissionRate.value === null) ||
      (lotteryCashingBonusRate.provided &&
        lotteryCashingBonusRate.value === null)
    ) {
      return NextResponse.json(
        {
          error:
            "Till float values must be valid non-negative numbers, scratch bin count must be 1-200, and lottery EFT rates must be 0-100",
        },
        { status: 400 },
      );
    }

    const target = await getStore(storeKey, access.adminClient);

    if (target.error) {
      return target.error;
    }

    const name = buildStoreName(body) || target.data.name;

    const { data, error } = await access.adminClient
      .from("stores")
      .update({
        name,
        status: normalizeStatus(body.status ?? target.data.status),
      })
      .eq("store_key", storeKey)
      .select(STORE_SELECT)
      .returns<StoreRow[]>()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update store" },
        { status: 500 },
      );
    }

    const currentSettings = await loadStoreTimeZoneMap(access.adminClient, [
      storeKey,
    ]);
    const existingSettings = currentSettings.get(storeKey);

    await saveStoreSettings(access.adminClient, storeKey, {
      timeZone:
        rawTimeZone && normalizedTimeZone
          ? normalizedTimeZone
          : (existingSettings?.timeZone ?? DEFAULT_TIME_ZONE),
      openingFloat:
        openingFloat.provided && openingFloat.value !== null
          ? openingFloat.value
          : (existingSettings?.openingFloat ??
            DEFAULT_STORE_CASH_MANAGEMENT.openingFloat),
      closingFloat:
        closingFloat.provided && closingFloat.value !== null
          ? closingFloat.value
          : (existingSettings?.closingFloat ??
            DEFAULT_STORE_CASH_MANAGEMENT.closingFloat),
      scratchBinCount:
        scratchBinCount.provided && scratchBinCount.value !== null
          ? scratchBinCount.value
          : (existingSettings?.scratchBinCount ??
            DEFAULT_STORE_SCRATCH_CARDS.binCount),
      lotteryRetailerCommissionRate:
        lotteryRetailerCommissionRate.provided &&
        lotteryRetailerCommissionRate.value !== null
          ? lotteryRetailerCommissionRate.value
          : (existingSettings?.lotteryRetailerCommissionRate ??
            DEFAULT_STORE_LOTTERY.retailerCommissionRate),
      lotteryCashingBonusRate:
        lotteryCashingBonusRate.provided &&
        lotteryCashingBonusRate.value !== null
          ? lotteryCashingBonusRate.value
          : (existingSettings?.lotteryCashingBonusRate ??
            DEFAULT_STORE_LOTTERY.cashingBonusRate),
    });

    const store = await buildStoreRecord(access.adminClient, data);

    await appendPrivateAdminAuditEvent({
      action: "private_admin.store_updated",
      metadata: {
        name,
        previousName: target.data.name,
        previousStatus: target.data.status,
        status: data.status,
      },
      request,
      result: "success",
      targetId: storeKey,
      targetStoreKey: storeKey,
      targetType: "store",
      token,
    });

    return NextResponse.json({
      store,
    });
  } catch (error) {
    console.error("Private admin stores PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update store" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const storeKey = normalizeStoreKey(
      request.nextUrl.searchParams.get("storeKey") ??
        request.nextUrl.searchParams.get("key"),
    );

    if (!storeKey) {
      return NextResponse.json(
        { error: "Missing required query parameter: storeKey" },
        { status: 400 },
      );
    }

    if (storeKey === DEFAULT_STORE_KEY) {
      return NextResponse.json(
        { error: "Default store cannot be deleted" },
        { status: 409 },
      );
    }

    const target = await getStore(storeKey, access.adminClient);

    if (target.error) {
      return target.error;
    }

    const { data: profileRows, error: profilesError } = await access.adminClient
      .from("profiles")
      .select("id,email")
      .eq("store_key", storeKey)
      .returns<StoreProfileRow[]>();

    if (profilesError) {
      return NextResponse.json(
        {
          error:
            profilesError.message ??
            "Failed to load store users before deletion",
        },
        { status: 500 },
      );
    }

    const { data: rpcResult, error: deleteError } =
      await access.adminClient.rpc("delete_store_and_data", {
        target_store_key: storeKey,
      });

    if (deleteError) {
      return NextResponse.json(
        {
          error:
            deleteError.message ??
            "Failed to delete store and store-scoped data",
        },
        { status: getRpcStoreDeleteStatus(deleteError) },
      );
    }

    const deleteSummary = (
      Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
    ) as StoreDeleteRpcRow | null;
    const authDeleteFailures: Array<{ email: string | null; id: string }> = [];

    for (const profile of profileRows ?? []) {
      const { error } = await access.adminClient.auth.admin.deleteUser(
        profile.id,
      );

      if (error) {
        authDeleteFailures.push({
          email: profile.email,
          id: profile.id,
        });
      }
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.store_deleted",
      metadata: {
        authDeleteFailures,
        deletedAuthUsers:
          (profileRows?.length ?? 0) - authDeleteFailures.length,
        deletedTables: Number(deleteSummary?.deleted_table_count ?? 0),
        name: target.data.name,
      },
      request,
      result: authDeleteFailures.length > 0 ? "failure" : "success",
      targetId: storeKey,
      targetStoreKey: storeKey,
      targetType: "store",
      token,
    });

    return NextResponse.json({
      success: true,
      storeKey,
      deletedTables: Number(deleteSummary?.deleted_table_count ?? 0),
      deletedAuthUsers: (profileRows?.length ?? 0) - authDeleteFailures.length,
      authDeleteFailures,
    });
  } catch (error) {
    console.error("Private admin stores DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete store" },
      { status: 500 },
    );
  }
}
