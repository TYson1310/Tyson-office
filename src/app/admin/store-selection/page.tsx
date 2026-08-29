"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { useAuth } from "@/contexts/AuthContext";
import { useStore } from "@/contexts/StoreContext";
import { createStoreHref } from "@/lib/store-query";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { CheckCircle2, ChevronRight, Store } from "lucide-react";

export default function AdminStoreSelectionPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    accessibleStores,
    activeStore,
    isAdmin,
    isLoading,
    refreshStoreContext,
    selectStore,
  } = useStore();
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthLoading || !user) {
      return;
    }

    if (!isAdmin) {
      router.replace(
        getPostLoginRedirectPath(user.role, user.storeKey, user.permissions),
      );
    }
  }, [isAdmin, isAuthLoading, router, user]);

  useEffect(() => {
    if (isAuthLoading || !user) {
      return;
    }

    void refreshStoreContext();
  }, [isAuthLoading, refreshStoreContext, user]);

  async function handleSelectStore(storeKey: string) {
    setError("");
    setIsSubmitting(storeKey);

    try {
      await selectStore(storeKey);
      router.replace(createStoreHref("/admin/dashboard", storeKey));
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "Failed to switch store",
      );
    } finally {
      setIsSubmitting(null);
    }
  }

  return (
    <>
      <Breadcrumb pageName="Store Selection" />

      {error ? (
        <div className="mb-6 rounded-[20px] border border-red/20 bg-red/10 px-5 py-4 text-sm text-red">
          {error}
        </div>
      ) : null}

      <SectionCard
        title="Select an active store"
        description="Choose the store workspace you want to manage for this session."
      >
        {isLoading ? (
          <div className="app-empty-state">Loading available stores...</div>
        ) : accessibleStores.length === 0 ? (
          <div className="app-empty-state">
            No stores are available yet. Add store records in Supabase before
            continuing.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accessibleStores.map((store) => {
              const isCurrentStore = activeStore?.storeKey === store.storeKey;
              const isBusy = isSubmitting === store.storeKey;

              return (
                <button
                  key={store.storeKey}
                  type="button"
                  onClick={() => void handleSelectStore(store.storeKey)}
                  disabled={isBusy}
                  className="app-surface-card group p-6 text-left transition hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-50/70 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-2xl bg-teal-500/10 p-3 text-primary">
                      <Store className="h-5 w-5" />
                    </div>
                    {isCurrentStore ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green/10 px-3 py-1 text-xs font-semibold text-green">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Active
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <h2 className="text-xl font-semibold text-slate-950">
                      {store.name}
                    </h2>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      {store.storeKey}
                    </p>
                    <p className="mt-4 text-sm text-slate-600">
                      {store.status === "active"
                        ? "Open this store workspace and load its dashboard, staff, vendors, sales, and payroll data."
                        : "This store is inactive. Select it only for review or maintenance."}
                    </p>
                  </div>

                  <div className="mt-6 flex items-center justify-between text-sm font-semibold text-primary">
                    <span>{isBusy ? "Switching..." : "Open workspace"}</span>
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>
    </>
  );
}
