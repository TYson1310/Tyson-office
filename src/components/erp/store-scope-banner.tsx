"use client";

import { MapPin } from "lucide-react";
import { useStore } from "@/contexts/StoreContext";

type StoreScopeBannerProps = {
  className?: string;
  storeKey?: string | null;
  storeName?: string | null;
  timeZone?: string | null;
};

export function StoreScopeBanner({
  className = "",
  storeKey,
  storeName,
  timeZone,
}: StoreScopeBannerProps) {
  const { activeStore } = useStore();
  const resolvedStoreName = storeName ?? activeStore?.name ?? "No store selected";
  const resolvedStoreKey = storeKey ?? activeStore?.storeKey ?? null;
  const resolvedTimeZone = timeZone ?? activeStore?.timeZone ?? "UTC";

  return (
    <div
      className={`mb-5 flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50/80 px-4 py-3 text-sm text-teal-950 shadow-sm sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-full bg-teal-600 p-1.5 text-white">
          <MapPin className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold">Posting to {resolvedStoreName}</div>
          <div className="mt-0.5 text-xs font-medium text-teal-800">
            Business dates and cutoffs use {resolvedTimeZone}.
          </div>
        </div>
      </div>

      {resolvedStoreKey ? (
        <div className="shrink-0 rounded-full border border-teal-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">
          {resolvedStoreKey}
        </div>
      ) : null}
    </div>
  );
}
