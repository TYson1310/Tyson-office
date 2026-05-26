import { BRAND } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_STORE_KEY } from "@/lib/stores/shared";
import { createClient } from "@/lib/supabase/server";

export const STORE_SETTINGS_KEY = DEFAULT_STORE_KEY;
export const PAYMENT_ENTRY_SENTINEL = "__payment__";

export type StoreSettingsSource = "database" | "unconfigured" | "fallback";

export type StoreProfileSettings = {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  currency: string;
  timezone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
};

export type StoreCashManagementSettings = {
  openingFloat: number;
  closingFloat: number;
};

export type StoreScratchCardSettings = {
  binCount: number;
};

export type StoreLotterySettings = {
  cashingBonusRate: number;
  retailerCommissionRate: number;
};

export type StorePaymentMethodSetting = {
  id: string;
  label: string;
  description: string;
  color: string;
  enabled: boolean;
  countsTowardCash: boolean;
};

export type StoreProductTypeSetting = {
  id: string;
  label: string;
  description: string;
  color: string;
  enabled: boolean;
};

export type StoreManagementSettings = {
  source: StoreSettingsSource;
  profile: StoreProfileSettings;
  accounting: {
    closeThroughDate: string | null;
    closeNote: string;
  };
  cashManagement: StoreCashManagementSettings;
  lottery: StoreLotterySettings;
  scratchCards: StoreScratchCardSettings;
  paymentMethods: StorePaymentMethodSetting[];
  productTypes: StoreProductTypeSetting[];
  updatedAt: string | null;
};

type StoreSettingsRow = {
  store_key: string;
  business_name: string | null;
  business_email: string | null;
  business_phone: string | null;
  currency_code: string | null;
  timezone_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  payment_methods: unknown;
  product_types: unknown;
  till_opening_float: number | string | null;
  till_closing_float: number | string | null;
  scratch_bin_count: number | string | null;
  lottery_retailer_commission_rate: number | string | null;
  lottery_cashing_bonus_rate: number | string | null;
  accounting_close_through: string | null;
  accounting_close_note: string | null;
  updated_at: string | null;
};

type StoreTimeZoneRow = {
  store_key: string;
  timezone_name: string | null;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const STORE_SETTINGS_SELECT_LEGACY =
  "store_key,business_name,business_email,business_phone,currency_code,timezone_name,address_line_1,address_line_2,city,state_region,postal_code,country,payment_methods,product_types,accounting_close_through,accounting_close_note,updated_at";
export const STORE_SETTINGS_SELECT = `${STORE_SETTINGS_SELECT_LEGACY},till_opening_float,till_closing_float,scratch_bin_count,lottery_retailer_commission_rate,lottery_cashing_bonus_rate`;
const STORE_TIME_ZONE_SELECT = "store_key,timezone_name";

const PAYMENT_COLORS = [
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#ea580c",
  "#475569",
  "#059669",
];

const PRODUCT_COLORS = [
  "#16a34a",
  "#2563eb",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#dc2626",
];

export const DEFAULT_STORE_PROFILE: StoreProfileSettings = {
  ...BRAND.defaultBusinessProfile,
};

export const DEFAULT_STORE_CASH_MANAGEMENT: StoreCashManagementSettings = {
  openingFloat: 500,
  closingFloat: 500,
};

export const DEFAULT_STORE_SCRATCH_CARDS: StoreScratchCardSettings = {
  binCount: 40,
};

export const DEFAULT_STORE_LOTTERY: StoreLotterySettings = {
  cashingBonusRate: 0,
  retailerCommissionRate: 0,
};

export const DEFAULT_PAYMENT_METHODS: StorePaymentMethodSetting[] = [
  {
    id: "cash",
    label: "Cash",
    description: "Bills and coins collected in the drawer",
    color: "#16a34a",
    enabled: true,
    countsTowardCash: true,
  },
  {
    id: "card",
    label: "Card",
    description: "Card terminal settlements",
    color: "#2563eb",
    enabled: true,
    countsTowardCash: false,
  },
  {
    id: "mobile",
    label: "Mobile Money",
    description: "Wallet and mobile transfer receipts",
    color: "#7c3aed",
    enabled: true,
    countsTowardCash: false,
  },
  {
    id: "bank_transfer",
    label: "Bank Transfer",
    description: "Direct bank or ACH payments",
    color: "#0891b2",
    enabled: true,
    countsTowardCash: false,
  },
  {
    id: "check",
    label: "Check",
    description: "Paper checks collected in store",
    color: "#ea580c",
    enabled: false,
    countsTowardCash: false,
  },
  {
    id: "other",
    label: "Other",
    description: "Fallback tender type",
    color: "#475569",
    enabled: true,
    countsTowardCash: false,
  },
];

export const DEFAULT_PRODUCT_TYPES: StoreProductTypeSetting[] = [
  {
    id: "net_sale",
    label: "Net Sale",
    description: "Sales before tax and fees",
    color: "#16a34a",
    enabled: true,
  },
  {
    id: "tax",
    label: "Tax",
    description: "Sales tax collected",
    color: "#f59e0b",
    enabled: true,
  },
  {
    id: "card_charge",
    label: "Card Charge",
    description: "Card processor or terminal charges",
    color: "#2563eb",
    enabled: true,
  },
  {
    id: "other_fees",
    label: "Other Fees",
    description: "Other daily charges and fees",
    color: "#9333ea",
    enabled: true,
  },
];

const LEGACY_DEFAULT_PRODUCT_TYPE_IDS = new Set([
  "groceries",
  "electronics",
  "apparel",
  "home_care",
  "beverages",
  "other",
]);

export function slugifySettingId(value: string, fallbackPrefix: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length > 0) {
    return normalized;
  }

  return `${fallbackPrefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
}

function normalizeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeIntegerInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const normalized = Math.trunc(normalizeNumber(value, fallback));

  if (normalized < minimum || normalized > maximum) {
    return fallback;
  }

  return normalized;
}

function normalizePercentInRange(value: unknown, fallback: number) {
  const normalized = normalizeNumber(value, fallback);

  if (normalized < 0 || normalized > 100) {
    return fallback;
  }

  return Math.round(normalized * 100) / 100;
}

function normalizePaymentMethods(value: unknown) {
  const source = Array.isArray(value) ? value : DEFAULT_PAYMENT_METHODS;
  const ids = new Set<string>();
  const normalized = source
    .map((item, index) => {
      const raw =
        typeof item === "object" && item !== null
          ? (item as Record<string, unknown>)
          : {};
      const label = normalizeString(
        raw.label,
        DEFAULT_PAYMENT_METHODS[index]?.label ?? "Payment",
      );
      const id = slugifySettingId(normalizeString(raw.id, label), "payment");

      if (ids.has(id)) {
        return null;
      }

      ids.add(id);

      return {
        id,
        label,
        description: normalizeString(raw.description),
        color: normalizeColor(
          raw.color,
          PAYMENT_COLORS[index % PAYMENT_COLORS.length],
        ),
        enabled: normalizeBoolean(raw.enabled, true),
        countsTowardCash: normalizeBoolean(
          raw.countsTowardCash ?? raw.counts_toward_cash,
          id === "cash",
        ),
      } satisfies StorePaymentMethodSetting;
    })
    .filter((item): item is StorePaymentMethodSetting => item !== null);

  if (normalized.length === 0) {
    return DEFAULT_PAYMENT_METHODS;
  }

  return normalized;
}

function normalizeProductTypes(value: unknown) {
  const source =
    Array.isArray(value) &&
    !(
      value.length === LEGACY_DEFAULT_PRODUCT_TYPE_IDS.size &&
      value.every((item) => {
        if (typeof item !== "object" || item === null) {
          return false;
        }

        const id = normalizeString((item as Record<string, unknown>).id);
        return LEGACY_DEFAULT_PRODUCT_TYPE_IDS.has(id);
      })
    )
      ? value
      : DEFAULT_PRODUCT_TYPES;
  const ids = new Set<string>();
  const normalized = source
    .map((item, index) => {
      const raw =
        typeof item === "object" && item !== null
          ? (item as Record<string, unknown>)
          : {};
      const label = normalizeString(
        raw.label,
        DEFAULT_PRODUCT_TYPES[index]?.label ?? "Sales detail",
      );
      const id = slugifySettingId(normalizeString(raw.id, label), "product");

      if (ids.has(id)) {
        return null;
      }

      ids.add(id);

      return {
        id,
        label,
        description: normalizeString(raw.description),
        color: normalizeColor(
          raw.color,
          PRODUCT_COLORS[index % PRODUCT_COLORS.length],
        ),
        enabled: normalizeBoolean(raw.enabled, true),
      } satisfies StoreProductTypeSetting;
    })
    .filter((item): item is StoreProductTypeSetting => item !== null);

  if (normalized.length === 0) {
    return DEFAULT_PRODUCT_TYPES;
  }

  return normalized;
}

export function createDefaultStoreSettings(
  source: StoreSettingsSource = "fallback",
): StoreManagementSettings {
  return {
    source,
    profile: { ...DEFAULT_STORE_PROFILE },
    accounting: {
      closeThroughDate: null,
      closeNote: "",
    },
    cashManagement: { ...DEFAULT_STORE_CASH_MANAGEMENT },
    lottery: { ...DEFAULT_STORE_LOTTERY },
    scratchCards: { ...DEFAULT_STORE_SCRATCH_CARDS },
    paymentMethods: [...DEFAULT_PAYMENT_METHODS],
    productTypes: [...DEFAULT_PRODUCT_TYPES],
    updatedAt: null,
  };
}

export function normalizeStoreSettings(
  row?: Partial<StoreSettingsRow> | null,
  source: StoreSettingsSource = "database",
): StoreManagementSettings {
  if (!row) {
    return createDefaultStoreSettings(
      source === "database" ? "fallback" : source,
    );
  }

  return {
    source,
    profile: {
      businessName: normalizeString(
        row.business_name,
        DEFAULT_STORE_PROFILE.businessName,
      ),
      businessEmail: normalizeString(
        row.business_email,
        DEFAULT_STORE_PROFILE.businessEmail,
      ),
      businessPhone: normalizeString(
        row.business_phone,
        DEFAULT_STORE_PROFILE.businessPhone,
      ),
      currency: normalizeString(
        row.currency_code,
        DEFAULT_STORE_PROFILE.currency,
      ),
      timezone: normalizeString(
        row.timezone_name,
        DEFAULT_STORE_PROFILE.timezone,
      ),
      addressLine1: normalizeString(
        row.address_line_1,
        DEFAULT_STORE_PROFILE.addressLine1,
      ),
      addressLine2: normalizeString(
        row.address_line_2,
        DEFAULT_STORE_PROFILE.addressLine2,
      ),
      city: normalizeString(row.city, DEFAULT_STORE_PROFILE.city),
      stateRegion: normalizeString(
        row.state_region,
        DEFAULT_STORE_PROFILE.stateRegion,
      ),
      postalCode: normalizeString(
        row.postal_code,
        DEFAULT_STORE_PROFILE.postalCode,
      ),
      country: normalizeString(row.country, DEFAULT_STORE_PROFILE.country),
    },
    accounting: {
      closeThroughDate:
        typeof row.accounting_close_through === "string"
          ? row.accounting_close_through
          : null,
      closeNote: normalizeString(row.accounting_close_note),
    },
    cashManagement: {
      openingFloat: normalizeNumber(
        row.till_opening_float,
        DEFAULT_STORE_CASH_MANAGEMENT.openingFloat,
      ),
      closingFloat: normalizeNumber(
        row.till_closing_float,
        DEFAULT_STORE_CASH_MANAGEMENT.closingFloat,
      ),
    },
    lottery: {
      cashingBonusRate: normalizePercentInRange(
        row.lottery_cashing_bonus_rate,
        DEFAULT_STORE_LOTTERY.cashingBonusRate,
      ),
      retailerCommissionRate: normalizePercentInRange(
        row.lottery_retailer_commission_rate,
        DEFAULT_STORE_LOTTERY.retailerCommissionRate,
      ),
    },
    scratchCards: {
      binCount: normalizeIntegerInRange(
        row.scratch_bin_count,
        DEFAULT_STORE_SCRATCH_CARDS.binCount,
        1,
        200,
      ),
    },
    paymentMethods: normalizePaymentMethods(row.payment_methods),
    productTypes: normalizeProductTypes(row.product_types),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

function buildBaseStoreSettingsPayload(
  settings: StoreManagementSettings,
  storeKey: string,
  updatedBy?: string | null,
) {
  return {
    store_key: storeKey,
    business_name: normalizeString(
      settings.profile.businessName,
      DEFAULT_STORE_PROFILE.businessName,
    ),
    business_email: normalizeString(
      settings.profile.businessEmail,
      DEFAULT_STORE_PROFILE.businessEmail,
    ),
    business_phone: normalizeString(
      settings.profile.businessPhone,
      DEFAULT_STORE_PROFILE.businessPhone,
    ),
    currency_code: normalizeString(
      settings.profile.currency,
      DEFAULT_STORE_PROFILE.currency,
    ),
    timezone_name: normalizeString(
      settings.profile.timezone,
      DEFAULT_STORE_PROFILE.timezone,
    ),
    address_line_1: normalizeString(
      settings.profile.addressLine1,
      DEFAULT_STORE_PROFILE.addressLine1,
    ),
    address_line_2: normalizeString(settings.profile.addressLine2),
    city: normalizeString(settings.profile.city, DEFAULT_STORE_PROFILE.city),
    state_region: normalizeString(
      settings.profile.stateRegion,
      DEFAULT_STORE_PROFILE.stateRegion,
    ),
    postal_code: normalizeString(
      settings.profile.postalCode,
      DEFAULT_STORE_PROFILE.postalCode,
    ),
    country: normalizeString(
      settings.profile.country,
      DEFAULT_STORE_PROFILE.country,
    ),
    accounting_close_through: settings.accounting.closeThroughDate,
    accounting_close_note: normalizeString(settings.accounting.closeNote),
    payment_methods: normalizePaymentMethods(settings.paymentMethods),
    product_types: normalizeProductTypes(settings.productTypes),
    updated_by: updatedBy ?? null,
  };
}

export function buildLegacyStoreSettingsPayload(
  settings: StoreManagementSettings,
  storeKey: string,
  updatedBy?: string | null,
) {
  return buildBaseStoreSettingsPayload(settings, storeKey, updatedBy);
}

export function buildStoreSettingsPayload(
  settings: StoreManagementSettings,
  storeKey: string,
  updatedBy?: string | null,
) {
  return {
    ...buildBaseStoreSettingsPayload(settings, storeKey, updatedBy),
    till_opening_float: Math.max(
      0,
      normalizeNumber(
        settings.cashManagement.openingFloat,
        DEFAULT_STORE_CASH_MANAGEMENT.openingFloat,
      ),
    ),
    till_closing_float: Math.max(
      0,
      normalizeNumber(
        settings.cashManagement.closingFloat,
        DEFAULT_STORE_CASH_MANAGEMENT.closingFloat,
      ),
    ),
    scratch_bin_count: normalizeIntegerInRange(
      settings.scratchCards.binCount,
      DEFAULT_STORE_SCRATCH_CARDS.binCount,
      1,
      200,
    ),
    lottery_retailer_commission_rate: normalizePercentInRange(
      settings.lottery.retailerCommissionRate,
      DEFAULT_STORE_LOTTERY.retailerCommissionRate,
    ),
    lottery_cashing_bonus_rate: normalizePercentInRange(
      settings.lottery.cashingBonusRate,
      DEFAULT_STORE_LOTTERY.cashingBonusRate,
    ),
  };
}

export function isStoreSettingsTableMissing(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("store_settings") && message.includes("does not exist")
  );
}

export function isStoreSettingsTillFieldsMissing(
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

function isDuplicateStoreSettingsRow(
  error:
    | {
        message?: string | null;
        code?: string | null;
      }
    | null
    | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "23505" ||
    message.includes("duplicate") ||
    message.includes("unique constraint")
  );
}

export async function initializeStoreSettingsForStore(
  supabase: SupabaseServerClient,
  storeKey: string,
) {
  if (!isSupabaseConfigured()) {
    return createDefaultStoreSettings("unconfigured");
  }

  const { error } = await supabase
    .from("store_settings")
    .insert({ store_key: storeKey })
    .select("store_key")
    .single<{ store_key: string }>();

  if (error) {
    if (isStoreSettingsTableMissing(error)) {
      return createDefaultStoreSettings("fallback");
    }

    if (isDuplicateStoreSettingsRow(error)) {
      return loadStoreSettingsForStore(supabase, storeKey);
    }

    throw error;
  }

  return loadStoreSettingsForStore(supabase, storeKey);
}

export async function loadStoreSettings(supabase: SupabaseServerClient) {
  return loadStoreSettingsForStore(supabase, STORE_SETTINGS_KEY);
}

export async function loadStoreSettingsForStore(
  supabase: SupabaseServerClient,
  storeKey: string,
) {
  if (!isSupabaseConfigured()) {
    return createDefaultStoreSettings("unconfigured");
  }

  let { data, error } = await supabase
    .from("store_settings")
    .select(STORE_SETTINGS_SELECT)
    .eq("store_key", storeKey)
    .maybeSingle<StoreSettingsRow>();

  if (error && isStoreSettingsTillFieldsMissing(error)) {
    ({ data, error } = await supabase
      .from("store_settings")
      .select(STORE_SETTINGS_SELECT_LEGACY)
      .eq("store_key", storeKey)
      .maybeSingle<StoreSettingsRow>());
  }

  if (error) {
    if (isStoreSettingsTableMissing(error)) {
      return createDefaultStoreSettings("fallback");
    }

    throw error;
  }

  return normalizeStoreSettings(data, data ? "database" : "fallback");
}

export async function loadStoreTimeZoneMap(
  supabase: SupabaseServerClient,
  storeKeys: string[],
) {
  if (!isSupabaseConfigured() || storeKeys.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from("store_settings")
    .select(STORE_TIME_ZONE_SELECT)
    .in("store_key", storeKeys)
    .returns<StoreTimeZoneRow[]>();

  if (error) {
    if (isStoreSettingsTableMissing(error)) {
      return new Map<string, string>();
    }

    throw error;
  }

  return new Map(
    (data ?? []).map((row) => [
      row.store_key,
      normalizeString(row.timezone_name, DEFAULT_STORE_PROFILE.timezone),
    ]),
  );
}

export function formatSettingLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
