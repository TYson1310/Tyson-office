import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { loadStoreTimeZoneMap } from "@/lib/store-settings";
import type { UserRole } from "@/types/erp.types";
import {
  ACTIVE_STORE_COOKIE,
  DEFAULT_STORE_KEY,
  DEFAULT_STORE_SUMMARY,
  normalizeStoreKey,
  type StoreSummary,
} from "./shared";

type StoreRow = {
  store_key: string;
  name: string;
  status: "active" | "inactive";
};

type StoreProfileRow = {
  role: UserRole | null;
  store_key: string | null;
};

export type ServerStoreContext = {
  activeStore: StoreSummary | null;
  activeStoreKey: string | null;
  assignedStoreKey: string | null;
  accessibleStores: StoreSummary[];
  isAdmin: boolean;
  needsSelection: boolean;
};

export type RequiredServerStoreContext = ServerStoreContext & {
  activeStore: StoreSummary;
  activeStoreKey: string;
};

function isStoresTableMissing(error: { message?: string | null } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("stores") && message.includes("does not exist");
}

async function loadAccessibleStores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: UserRole | null,
  assignedStoreKey: string | null,
) {
  if (!isSupabaseConfigured()) {
    return [DEFAULT_STORE_SUMMARY];
  }

  let query = supabase
    .from("stores")
    .select("store_key,name,status")
    .order("name", { ascending: true });

  if (role !== "admin") {
    query = query.eq("store_key", assignedStoreKey ?? DEFAULT_STORE_KEY);
  }

  const { data, error } = await query.returns<StoreRow[]>();

  if (error) {
    if (isStoresTableMissing(error)) {
      return [DEFAULT_STORE_SUMMARY];
    }

    throw error;
  }

  const timeZoneMap = await loadStoreTimeZoneMap(
    supabase,
    (data ?? []).map((row) => row.store_key),
  );
  const stores = (data ?? []).map((row) => ({
    storeKey: row.store_key,
    name: row.name,
    status: row.status,
    timeZone: timeZoneMap.get(row.store_key) ?? DEFAULT_STORE_SUMMARY.timeZone,
  }));

  if (stores.length === 0 && role !== "admin") {
    return [DEFAULT_STORE_SUMMARY];
  }

  return stores;
}

export async function getServerStoreContext(): Promise<ServerStoreContext> {
  if (!isSupabaseConfigured()) {
    return {
      activeStore: DEFAULT_STORE_SUMMARY,
      activeStoreKey: DEFAULT_STORE_SUMMARY.storeKey,
      assignedStoreKey: DEFAULT_STORE_SUMMARY.storeKey,
      accessibleStores: [DEFAULT_STORE_SUMMARY],
      isAdmin: false,
      needsSelection: false,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getUserSafely(supabase);

  if (!user) {
    return {
      activeStore: null,
      activeStoreKey: null,
      assignedStoreKey: null,
      accessibleStores: [],
      isAdmin: false,
      needsSelection: false,
    };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role,store_key")
    .eq("id", user.id)
    .maybeSingle<StoreProfileRow>();

  if (error) {
    throw error;
  }

  const role = profile?.role ?? "employee";
  const assignedStoreKey = normalizeStoreKey(profile?.store_key) ?? DEFAULT_STORE_KEY;
  const accessibleStores = await loadAccessibleStores(supabase, role, assignedStoreKey);
  const cookieStore = await cookies();
  const requestedStoreKey = normalizeStoreKey(
    cookieStore.get(ACTIVE_STORE_COOKIE)?.value ?? null,
  );

  if (role === "admin") {
    const activeStore =
      accessibleStores.find((store) => store.storeKey === requestedStoreKey) ?? null;

    return {
      activeStore,
      activeStoreKey: activeStore?.storeKey ?? null,
      assignedStoreKey,
      accessibleStores,
      isAdmin: true,
      needsSelection: !activeStore,
    };
  }

  const activeStore =
    accessibleStores.find((store) => store.storeKey === assignedStoreKey) ??
    accessibleStores[0] ??
    DEFAULT_STORE_SUMMARY;

  return {
    activeStore,
    activeStoreKey: activeStore.storeKey,
    assignedStoreKey: assignedStoreKey,
    accessibleStores,
    isAdmin: false,
    needsSelection: false,
  };
}

export async function requireActiveStoreContext(): Promise<RequiredServerStoreContext> {
  const context = await getServerStoreContext();

  if (context.isAdmin && context.needsSelection) {
    redirect("/admin/store-selection");
  }

  if (!context.activeStore) {
    redirect("/auth/login");
  }

  return {
    ...context,
    activeStore: context.activeStore,
    activeStoreKey: context.activeStoreKey ?? context.activeStore.storeKey,
  };
}
