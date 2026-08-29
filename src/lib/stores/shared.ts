import { BRAND } from "@/lib/brand";

export const ACTIVE_STORE_COOKIE = "active_store_key";
export const DEFAULT_STORE_KEY = "default";

export type StoreStatus = "active" | "inactive";

export type StoreSummary = {
  storeKey: string;
  name: string;
  status: StoreStatus;
  timeZone: string;
};

export const DEFAULT_STORE_SUMMARY: StoreSummary = {
  storeKey: DEFAULT_STORE_KEY,
  name: "Default Store",
  status: "active",
  timeZone: BRAND.defaultBusinessProfile.timezone,
};

export function normalizeStoreKey(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}
