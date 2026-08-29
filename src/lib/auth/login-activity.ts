import { unstable_noStore as noStore } from "next/cache";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { LoginDeviceType } from "./login-activity-shared";
import { isLoginActivityRelationMissing } from "./login-activity-shared";

type LoginActivityRow = {
  id: string;
  session_id: string | null;
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  assigned_store_key: string | null;
  ip_address: string | null;
  user_agent: string;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  os_version: string | null;
  device_type: LoginDeviceType;
  device_name: string | null;
  metadata: Record<string, unknown> | null;
  signed_in_at: string;
  last_seen_at: string;
};

type StoreRow = {
  store_key: string;
  name: string;
};

export type LoginActivityRecord = {
  id: string;
  sessionId?: string;
  userId: string;
  email: string;
  fullName: string;
  role: string;
  assignedStoreKey?: string;
  assignedStoreName?: string;
  ipAddress?: string;
  userAgent: string;
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  osVersion?: string;
  deviceType: LoginDeviceType;
  deviceName?: string;
  metadata: Record<string, unknown>;
  signedInAt: Date;
  lastSeenAt: Date;
};

export async function listLoginActivity(limit = 100) {
  noStore();

  if (!isSupabaseConfigured()) {
    return {
      sessions: [] as LoginActivityRecord[],
      compatibilityMode: false,
      warning: null as string | null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("login_activity")
    .select(
      "id,session_id,user_id,email,full_name,role,assigned_store_key,ip_address,user_agent,browser_name,browser_version,os_name,os_version,device_type,device_name,metadata,signed_in_at,last_seen_at",
    )
    .order("signed_in_at", { ascending: false })
    .limit(limit)
    .returns<LoginActivityRow[]>();

  if (error) {
    if (isLoginActivityRelationMissing(error)) {
      return {
        sessions: [] as LoginActivityRecord[],
        compatibilityMode: true,
        warning:
          "Login tracking is not available until the latest Supabase migration is applied.",
      };
    }

    console.error("Failed to load login activity:", error.message ?? error);
    return {
      sessions: [] as LoginActivityRecord[],
      compatibilityMode: false,
      warning: "Failed to load login activity.",
    };
  }

  const storeKeys = Array.from(
    new Set(
      (data ?? [])
        .map((row) => row.assigned_store_key)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const storeNameMap = new Map<string, string>();

  if (storeKeys.length > 0) {
    const { data: stores, error: storeError } = await supabase
      .from("stores")
      .select("store_key,name")
      .in("store_key", storeKeys)
      .returns<StoreRow[]>();

    if (storeError) {
      console.error("Failed to load login activity store names:", storeError);
    } else {
      for (const store of stores ?? []) {
        storeNameMap.set(store.store_key, store.name);
      }
    }
  }

  return {
    sessions: (data ?? []).map((row) => ({
      id: row.id,
      sessionId: row.session_id ?? undefined,
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      assignedStoreKey: row.assigned_store_key ?? undefined,
      assignedStoreName: row.assigned_store_key
        ? storeNameMap.get(row.assigned_store_key)
        : undefined,
      ipAddress: row.ip_address ?? undefined,
      userAgent: row.user_agent,
      browserName: row.browser_name ?? undefined,
      browserVersion: row.browser_version ?? undefined,
      osName: row.os_name ?? undefined,
      osVersion: row.os_version ?? undefined,
      deviceType: row.device_type,
      deviceName: row.device_name ?? undefined,
      metadata:
        row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      signedInAt: new Date(row.signed_in_at),
      lastSeenAt: new Date(row.last_seen_at),
    })),
    compatibilityMode: false,
    warning: null as string | null,
  };
}

export {
  decodeSupabaseAccessTokenClaims,
  extractClientIpAddress,
  isLoginActivityRelationMissing,
  parseUserAgent,
  type LoginDeviceType,
  type ParsedUserAgent,
} from "./login-activity-shared";
