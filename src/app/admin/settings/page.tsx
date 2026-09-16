"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { useStore } from "@/contexts/StoreContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  createDefaultStoreSettings,
  formatSettingLabel,
  slugifySettingId,
  type StoreManagementSettings,
  type StorePaymentMethodSetting,
  type StoreProductTypeSetting,
} from "@/lib/store-settings";
import { formatDateTime, isValidTimeZone } from "@/lib/date-time";
import {
  clearOnlyStaleAppStorage,
  getBrowserStorageAuditSummary,
} from "@/lib/browser-storage-audit";
import { LoaderCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react";

type PaymentDraft = Omit<StorePaymentMethodSetting, "id"> & {
  label: string;
};

type ProductDraft = Omit<StoreProductTypeSetting, "id"> & {
  label: string;
};

const EMPTY_PAYMENT_DRAFT: PaymentDraft = {
  label: "",
  description: "",
  color: "#0f766e",
  enabled: true,
  countsTowardCash: false,
};

const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  label: "",
  description: "",
  color: "#2563eb",
  enabled: true,
};

const PANEL_CLASSNAME = "app-muted-panel rounded-[28px] p-5";
const DASHED_PANEL_CLASSNAME = "app-empty-state rounded-[28px] p-5 text-left";
const FIELD_LABEL_CLASSNAME =
  "mb-2 block text-sm font-medium text-dark dark:text-white";
const INPUT_CLASSNAME = "app-input";
const COLOR_INPUT_WRAPPER_CLASSNAME =
  "flex items-center gap-3 rounded-xl border border-slate-200 bg-white/92 px-3 py-2 shadow-sm";
const TOGGLE_PILL_CLASSNAME = "app-secondary-button";
const PRIMARY_BUTTON_CLASSNAME =
  "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70";
const SECONDARY_BUTTON_CLASSNAME =
  "app-secondary-button disabled:cursor-not-allowed disabled:opacity-70";

function formatTimestamp(value: string | null, timeZone: string) {
  if (!value) {
    return "Not saved yet";
  }

  const resolvedTimeZone = isValidTimeZone(timeZone) ? timeZone : undefined;

  return formatDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
  });
}

function toLocalOptions<T extends { id: string; enabled: boolean }>(
  items: T[],
) {
  return {
    enabledCount: items.filter((item) => item.enabled).length,
    totalCount: items.length,
  };
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { notify } = useAppNotifications();
  const {
    activeStore,
    isAdmin,
    isLoading: isStoreLoading,
    needsSelection,
  } = useStore();
  const [settings, setSettings] = useState<StoreManagementSettings>(() =>
    createDefaultStoreSettings("fallback"),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [paymentDraft, setPaymentDraft] =
    useState<PaymentDraft>(EMPTY_PAYMENT_DRAFT);
  const [productDraft, setProductDraft] =
    useState<ProductDraft>(EMPTY_PRODUCT_DRAFT);
  const [isAddingPaymentType, setIsAddingPaymentType] = useState(false);
  const [isAddingProductType, setIsAddingProductType] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [storageAudit, setStorageAudit] = useState(() =>
    getBrowserStorageAuditSummary(),
  );
  const [lastStorageClearAt, setLastStorageClearAt] = useState<string | null>(
    () => {
      if (typeof window === "undefined") {
        return null;
      }

      return window.localStorage.getItem("app:last-stale-storage-cleared-at");
    },
  );
  const [isConfirmingStorageClear, setIsConfirmingStorageClear] =
    useState(false);
  const [isClearingStorage, setIsClearingStorage] = useState(false);
  const [staleStorageKeys, setStaleStorageKeys] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const keys = new Set<string>();
    for (const key of [
      "authSession",
      "theme",
      "reports:selectedCategory",
      "theme:v2",
      "reports:selectedCategory:v1",
    ]) {
      try {
        if (
          window.localStorage.getItem(key) !== null ||
          window.sessionStorage.getItem(key) !== null
        ) {
          keys.add(key);
        }
      } catch {
        // ignore access issues
      }
    }

    return Array.from(keys);
  });
  const [activeManager, setActiveManager] = useState<"payments" | "products">(
    "payments",
  );
  const [editingPaymentDraft, setEditingPaymentDraft] =
    useState<PaymentDraft>(EMPTY_PAYMENT_DRAFT);
  const [editingProductDraft, setEditingProductDraft] =
    useState<ProductDraft>(EMPTY_PRODUCT_DRAFT);

  useEffect(() => {
    const updateStorageAudit = () => {
      const nextAudit = getBrowserStorageAuditSummary();
      setStorageAudit(nextAudit);
      setStaleStorageKeys([
        ...new Set([
          ...nextAudit.authKeys,
          ...nextAudit.legacyKeys,
          ...nextAudit.preferenceKeys,
        ]),
      ]);
    };

    updateStorageAudit();
    window.addEventListener("storage", updateStorageAudit);

    return () => {
      window.removeEventListener("storage", updateStorageAudit);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextTimestamp = window.localStorage.getItem(
      "app:last-stale-storage-cleared-at",
    );
    setLastStorageClearAt(nextTimestamp);
  }, [storageAudit.totalEntries]);

  async function handleClearStaleAppStorage() {
    setIsClearingStorage(true);

    try {
      const clearedKeys = clearOnlyStaleAppStorage();
      const nextAudit = getBrowserStorageAuditSummary();
      setStorageAudit(nextAudit);
      setStaleStorageKeys(clearedKeys.length > 0 ? clearedKeys : []);
      const nextTimestamp = localStorage.getItem("app:last-stale-storage-cleared-at");
      setLastStorageClearAt(nextTimestamp);
      showNotice(
        "success",
        "Stale app browser data cleared without affecting imported business data.",
      );
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to clear stale app browser data.",
      );
    } finally {
      setIsClearingStorage(false);
      setIsConfirmingStorageClear(false);
    }
  }

  const paymentSummary = useMemo(
    () => toLocalOptions(settings.paymentMethods),
    [settings.paymentMethods],
  );
  const productSummary = useMemo(
    () => toLocalOptions(settings.productTypes),
    [settings.productTypes],
  );
  const isManagingPayments = activeManager === "payments";

  const showNotice = useCallback(
    (type: "success" | "error", message: string) => {
      notify({ type, message });
    },
    [notify],
  );

  const persistSettingsSnapshot = useCallback(
    async (nextSettings: StoreManagementSettings, successMessage: string) => {
      setIsSaving(true);

      try {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(nextSettings),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to save store settings");
        }

        setSettings(payload as StoreManagementSettings);
        showNotice("success", successMessage);
        return true;
      } catch (error) {
        showNotice(
          "error",
          error instanceof Error
            ? error.message
            : "Failed to save store settings",
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [showNotice],
  );

  useEffect(() => {
    if (!isStoreLoading && isAdmin && needsSelection) {
      router.replace("/admin/store-selection");
      return;
    }

    if (!activeStore?.storeKey) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadSettings() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load store settings");
        }

        if (isMounted) {
          setSettings(payload as StoreManagementSettings);
        }
      } catch (error) {
        if (isMounted) {
          showNotice(
            "error",
            error instanceof Error
              ? error.message
              : "Failed to load store settings",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, [
    activeStore?.storeKey,
    isAdmin,
    isStoreLoading,
    needsSelection,
    router,
    showNotice,
  ]);

  function updateProfileField<
    K extends keyof StoreManagementSettings["profile"],
  >(key: K, value: StoreManagementSettings["profile"][K]) {
    setSettings((current) => ({
      ...current,
      profile: {
        ...current.profile,
        [key]: value,
      },
    }));
  }

  function updateAccountingField<
    K extends keyof StoreManagementSettings["accounting"],
  >(key: K, value: StoreManagementSettings["accounting"][K]) {
    setSettings((current) => ({
      ...current,
      accounting: {
        ...current.accounting,
        [key]: value,
      },
    }));
  }

  function updateCashManagementField<
    K extends keyof StoreManagementSettings["cashManagement"],
  >(key: K, value: StoreManagementSettings["cashManagement"][K]) {
    setSettings((current) => ({
      ...current,
      cashManagement: {
        ...current.cashManagement,
        [key]: value,
      },
    }));
  }

  function updateLotteryField<
    K extends keyof StoreManagementSettings["lottery"],
  >(key: K, value: StoreManagementSettings["lottery"][K]) {
    setSettings((current) => ({
      ...current,
      lottery: {
        ...current.lottery,
        [key]: value,
      },
    }));
  }

  function startPaymentEdit(id: string) {
    const method = settings.paymentMethods.find((item) => item.id === id);

    if (!method) {
      return;
    }

    setIsAddingPaymentType(false);
    setEditingPaymentId(id);
    setEditingPaymentDraft({
      label: method.label,
      description: method.description,
      color: method.color,
      enabled: method.enabled,
      countsTowardCash: method.countsTowardCash,
    });
  }

  function startProductEdit(id: string) {
    const type = settings.productTypes.find((item) => item.id === id);

    if (!type) {
      return;
    }

    setIsAddingProductType(false);
    setEditingProductId(id);
    setEditingProductDraft({
      label: type.label,
      description: type.description,
      color: type.color,
      enabled: type.enabled,
    });
  }

  function cancelPaymentEdit() {
    setEditingPaymentId(null);
    setEditingPaymentDraft(EMPTY_PAYMENT_DRAFT);
  }

  function cancelProductEdit() {
    setEditingProductId(null);
    setEditingProductDraft(EMPTY_PRODUCT_DRAFT);
  }

  async function savePaymentEdit() {
    if (!editingPaymentId) {
      return;
    }

    const label = editingPaymentDraft.label.trim();

    if (!label) {
      showNotice("error", "Enter a payment method name before saving changes.");
      return;
    }

    const nextSettings = {
      ...settings,
      paymentMethods: settings.paymentMethods.map((method) =>
        method.id === editingPaymentId
          ? { ...method, ...editingPaymentDraft, label }
          : method,
      ),
    };

    const saved = await persistSettingsSnapshot(
      nextSettings,
      "Payment type updated successfully.",
    );

    if (saved) {
      cancelPaymentEdit();
    }
  }

  async function saveProductEdit() {
    if (!editingProductId) {
      return;
    }

    const label = editingProductDraft.label.trim();

    if (!label) {
      showNotice(
        "error",
        "Enter a sales detail type name before saving changes.",
      );
      return;
    }

    const nextSettings = {
      ...settings,
      productTypes: settings.productTypes.map((type) =>
        type.id === editingProductId
          ? { ...type, ...editingProductDraft, label }
          : type,
      ),
    };

    const saved = await persistSettingsSnapshot(
      nextSettings,
      "Sales detail type updated successfully.",
    );

    if (saved) {
      cancelProductEdit();
    }
  }

  async function removePaymentMethod(id: string) {
    const method = settings.paymentMethods.find((item) => item.id === id);

    if (!method) {
      return;
    }

    if (settings.paymentMethods.length === 1) {
      showNotice("error", "At least one payment method must remain.");
      return;
    }

    const nextSettings = {
      ...settings,
      paymentMethods: settings.paymentMethods.filter((item) => item.id !== id),
    };
    const saved = await persistSettingsSnapshot(
      nextSettings,
      "Payment type deleted successfully.",
    );

    if (saved && editingPaymentId === id) {
      cancelPaymentEdit();
    }
  }

  async function removeProductType(id: string) {
    const type = settings.productTypes.find((item) => item.id === id);

    if (!type) {
      return;
    }

    if (settings.productTypes.length === 1) {
      showNotice("error", "At least one sales detail type must remain.");
      return;
    }

    const nextSettings = {
      ...settings,
      productTypes: settings.productTypes.filter((item) => item.id !== id),
    };
    const saved = await persistSettingsSnapshot(
      nextSettings,
      "Sales detail type deleted successfully.",
    );

    if (saved && editingProductId === id) {
      cancelProductEdit();
    }
  }

  async function addPaymentMethod() {
    const label = paymentDraft.label.trim();

    if (!label) {
      showNotice("error", "Enter a payment method name before adding it.");
      return;
    }

    const id = slugifySettingId(label, "payment");

    if (settings.paymentMethods.some((method) => method.id === id)) {
      showNotice("error", "A payment method with that code already exists.");
      return;
    }

    const nextSettings = {
      ...settings,
      paymentMethods: [
        ...settings.paymentMethods,
        {
          id,
          ...paymentDraft,
          label,
        },
      ],
    };
    const saved = await persistSettingsSnapshot(
      nextSettings,
      "Payment type added successfully.",
    );

    if (saved) {
      setPaymentDraft(EMPTY_PAYMENT_DRAFT);
      setIsAddingPaymentType(false);
    }
  }

  async function addProductType() {
    const label = productDraft.label.trim();

    if (!label) {
      showNotice("error", "Enter a sales detail type name before adding it.");
      return;
    }

    const id = slugifySettingId(label, "sales_detail");

    if (settings.productTypes.some((type) => type.id === id)) {
      showNotice("error", "A sales detail type with that code already exists.");
      return;
    }

    const nextSettings = {
      ...settings,
      productTypes: [
        ...settings.productTypes,
        {
          id,
          ...productDraft,
          label,
        },
      ],
    };
    const saved = await persistSettingsSnapshot(
      nextSettings,
      "Sales detail type added successfully.",
    );

    if (saved) {
      setProductDraft(EMPTY_PRODUCT_DRAFT);
      setIsAddingProductType(false);
    }
  }

  async function handleSave() {
    if (paymentSummary.enabledCount === 0) {
      showNotice("error", "Enable at least one payment method before saving.");
      return;
    }

    if (productSummary.enabledCount === 0) {
      showNotice(
        "error",
        "Enable at least one sales detail type before saving.",
      );
      return;
    }

    await persistSettingsSnapshot(
      settings,
      "Store settings saved successfully.",
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumb pageName="Store Settings" />

      {activeStore ? (
        <div className="mb-6 inline-flex items-center rounded-full bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {activeStore.name}
        </div>
      ) : null}

      {settings.source !== "database" ? (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-1 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:shadow-card">
          {settings.source === "unconfigured"
            ? "Supabase is not configured. You can review the layout, but saving settings requires the database connection."
            : "Store settings are showing default values for this store. The app will create a saved settings record automatically; if that still fails, apply the latest Supabase migration for the store settings table."}
        </div>
      ) : null}

      <SectionCard
        title="Browser storage audit"
        description="Monitor app-level browser storage without touching imported business data."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
            <p className="text-xs uppercase tracking-[0.2em] text-dark-5 dark:text-dark-6">
              Auth/session keys
            </p>
            <p className="mt-2 text-2xl font-semibold text-dark dark:text-white">
              {storageAudit.authKeys.length}
            </p>
            <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
              {storageAudit.authKeys.length > 0
                ? storageAudit.authKeys.join(", ")
                : "No active auth keys detected"}
            </p>
          </div>

          <div className="rounded-[18px] border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
            <p className="text-xs uppercase tracking-[0.2em] text-dark-5 dark:text-dark-6">
              Preference keys
            </p>
            <p className="mt-2 text-2xl font-semibold text-dark dark:text-white">
              {storageAudit.preferenceKeys.length}
            </p>
            <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
              {storageAudit.preferenceKeys.length > 0
                ? storageAudit.preferenceKeys.join(", ")
                : "No preference data detected"}
            </p>
          </div>

          <div className="rounded-[18px] border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
            <p className="text-xs uppercase tracking-[0.2em] text-dark-5 dark:text-dark-6">
              Legacy keys
            </p>
            <p className="mt-2 text-2xl font-semibold text-dark dark:text-white">
              {storageAudit.legacyKeys.length}
            </p>
            <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
              {storageAudit.legacyKeys.length > 0
                ? storageAudit.legacyKeys.join(", ")
                : "No legacy app keys detected"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-dark-5 dark:text-dark-6">
            <p>
              Total browser entries tracked: <span className="font-semibold text-dark dark:text-white">{storageAudit.totalEntries}</span>. This panel only reports app-level state and does not include imported business records, uploaded files, or database-backed data.
            </p>
            {lastStorageClearAt ? (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Last stale app cleanup: {new Date(lastStorageClearAt).toLocaleString()}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setIsConfirmingStorageClear(true)}
            disabled={isClearingStorage || storageAudit.totalEntries === 0}
            className={SECONDARY_BUTTON_CLASSNAME}
          >
            {isClearingStorage ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Clearing...
              </>
            ) : (
              "Clear stale app browser data"
            )}
          </button>
        </div>
      </SectionCard>

      {isConfirmingStorageClear ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={() => setIsConfirmingStorageClear(false)}
          />
          <div className="relative z-10 mx-4 w-full max-w-lg rounded-[28px] border border-stroke bg-white p-6 text-dark shadow-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white">
            <p className="text-lg font-semibold text-dark dark:text-white">
              Confirm stale browser data cleanup
            </p>
            <p className="mt-3 text-sm text-dark-5 dark:text-dark-6">
              This removes only app-level browser state such as auth/session and UI preference keys. It does not delete imported business data, uploaded files, or database-backed records.
            </p>

            {staleStorageKeys.length > 0 ? (
              <div className="mt-4 rounded-[18px] border border-stroke bg-gray-1 p-3 dark:border-dark-3 dark:bg-dark-2">
                <p className="text-xs uppercase tracking-[0.2em] text-dark-5 dark:text-dark-6">
                  Keys to be removed
                </p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-dark-5 dark:text-dark-6">
                  {staleStorageKeys.map((key) => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleClearStaleAppStorage()}
                className={PRIMARY_BUTTON_CLASSNAME}
                disabled={!isAdmin || isClearingStorage}
              >
                <Trash2 className="h-4 w-4" />
                {isClearingStorage ? "Clearing..." : "Confirm cleanup"}
              </button>
              <button
                type="button"
                onClick={() => setIsConfirmingStorageClear(false)}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Store details"
        description="Keep only the essentials visible here. Address and regional fields stay tucked away unless you need them."
        action={
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isLoading || isSaving}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isSaving ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save settings
          </button>
        }
      >
        {isLoading ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-dark-5 dark:text-dark-6">
            <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
            Loading store settings...
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <label className="block xl:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Store name</span>
                <input
                  type="text"
                  value={settings.profile.businessName}
                  onChange={(event) =>
                    updateProfileField("businessName", event.target.value)
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block xl:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Business email</span>
                <input
                  type="email"
                  value={settings.profile.businessEmail}
                  onChange={(event) =>
                    updateProfileField("businessEmail", event.target.value)
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Phone</span>
                <input
                  type="tel"
                  value={settings.profile.businessPhone}
                  onChange={(event) =>
                    updateProfileField("businessPhone", event.target.value)
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Currency</span>
                <input
                  type="text"
                  value={settings.profile.currency}
                  onChange={(event) =>
                    updateProfileField(
                      "currency",
                      event.target.value.toUpperCase(),
                    )
                  }
                  className={`${INPUT_CLASSNAME} uppercase`}
                />
              </label>

              <label className="block md:col-span-2 xl:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Timezone</span>
                <input
                  type="text"
                  value={settings.profile.timezone}
                  onChange={(event) =>
                    updateProfileField("timezone", event.target.value)
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>

              <div className={`${PANEL_CLASSNAME} md:col-span-2 xl:col-span-2`}>
                <p className="text-sm font-medium text-dark dark:text-white">
                  Publishing status
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge
                    tone={
                      settings.source === "database"
                        ? "green"
                        : settings.source === "unconfigured"
                          ? "red"
                          : "amber"
                    }
                  >
                    {settings.source === "database"
                      ? "Live settings"
                      : settings.source === "unconfigured"
                        ? "Database offline"
                        : "Fallback defaults"}
                  </StatusBadge>
                  <StatusBadge tone="slate">
                    {formatTimestamp(
                      settings.updatedAt,
                      settings.profile.timezone,
                    )}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <details className={PANEL_CLASSNAME}>
              <summary className="cursor-pointer list-none text-sm font-medium text-dark outline-none dark:text-white">
                Address and regional details
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className={FIELD_LABEL_CLASSNAME}>Address line 1</span>
                  <input
                    type="text"
                    value={settings.profile.addressLine1}
                    onChange={(event) =>
                      updateProfileField("addressLine1", event.target.value)
                    }
                    className={INPUT_CLASSNAME}
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className={FIELD_LABEL_CLASSNAME}>Address line 2</span>
                  <input
                    type="text"
                    value={settings.profile.addressLine2}
                    onChange={(event) =>
                      updateProfileField("addressLine2", event.target.value)
                    }
                    className={INPUT_CLASSNAME}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL_CLASSNAME}>City</span>
                  <input
                    type="text"
                    value={settings.profile.city}
                    onChange={(event) =>
                      updateProfileField("city", event.target.value)
                    }
                    className={INPUT_CLASSNAME}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL_CLASSNAME}>State / region</span>
                  <input
                    type="text"
                    value={settings.profile.stateRegion}
                    onChange={(event) =>
                      updateProfileField("stateRegion", event.target.value)
                    }
                    className={INPUT_CLASSNAME}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL_CLASSNAME}>Postal code</span>
                  <input
                    type="text"
                    value={settings.profile.postalCode}
                    onChange={(event) =>
                      updateProfileField("postalCode", event.target.value)
                    }
                    className={INPUT_CLASSNAME}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL_CLASSNAME}>Country</span>
                  <input
                    type="text"
                    value={settings.profile.country}
                    onChange={(event) =>
                      updateProfileField("country", event.target.value)
                    }
                    className={INPUT_CLASSNAME}
                  />
                </label>
              </div>
            </details>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Accounting controls"
        description="Close books through a store-specific date to stop edits, approvals, voids, and deletions in closed financial periods."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
          <label className="block">
            <span className={FIELD_LABEL_CLASSNAME}>Close through date</span>
            <input
              type="date"
              value={settings.accounting.closeThroughDate ?? ""}
              onChange={(event) =>
                updateAccountingField(
                  "closeThroughDate",
                  event.target.value || null,
                )
              }
              className={INPUT_CLASSNAME}
            />
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASSNAME}>Close note</span>
            <input
              type="text"
              value={settings.accounting.closeNote}
              onChange={(event) =>
                updateAccountingField("closeNote", event.target.value)
              }
              className={INPUT_CLASSNAME}
              placeholder="Month-end close complete"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                updateAccountingField("closeThroughDate", null);
                updateAccountingField("closeNote", "");
              }}
              className={SECONDARY_BUTTON_CLASSNAME}
            >
              Clear lock
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-dark-5 dark:text-dark-6">
          <StatusBadge
            tone={settings.accounting.closeThroughDate ? "amber" : "green"}
          >
            {settings.accounting.closeThroughDate
              ? `Closed through ${settings.accounting.closeThroughDate}`
              : "No close date set"}
          </StatusBadge>
          <span>
            Closed dates apply to vendor invoices, vendor payments, supplier
            adjustments, and general expenses for this store.
          </span>
        </div>
      </SectionCard>

      <SectionCard
        title="Till Defaults"
        description="Seed the daily sales closeout form with the opening and closing cash float expected for this store."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:max-w-3xl">
          <label className="block">
            <span className={FIELD_LABEL_CLASSNAME}>Opening float</span>
            <CurrencyInput
              value={settings.cashManagement.openingFloat}
              onValueChange={(_, numericValue) =>
                updateCashManagementField(
                  "openingFloat",
                  Math.max(0, numericValue),
                )
              }
              className={INPUT_CLASSNAME}
            />
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASSNAME}>Closing float</span>
            <CurrencyInput
              value={settings.cashManagement.closingFloat}
              onValueChange={(_, numericValue) =>
                updateCashManagementField(
                  "closingFloat",
                  Math.max(0, numericValue),
                )
              }
              className={INPUT_CLASSNAME}
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="Lottery Defaults"
        description="Set lottery EFT commission rates used for weekly lottery settlement calculations."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:max-w-3xl">
          <label className="block">
            <span className={FIELD_LABEL_CLASSNAME}>Retailer commission %</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={settings.lottery.retailerCommissionRate}
              onChange={(event) =>
                updateLotteryField(
                  "retailerCommissionRate",
                  Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                )
              }
              className={INPUT_CLASSNAME}
            />
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASSNAME}>Payout commission %</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={settings.lottery.cashingBonusRate}
              onChange={(event) =>
                updateLotteryField(
                  "cashingBonusRate",
                  Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                )
              }
              className={INPUT_CLASSNAME}
            />
          </label>
        </div>
        <p className="mt-3 text-sm text-dark-5 dark:text-dark-6">
          Lottery EOD still counts the full physical drawer. Cash in hand uses
          counted cash minus this held-back float.
        </p>
      </SectionCard>

      <SectionCard
        title="Sales Desk Manager"
        description="Switch between payment types and sales detail types so you only edit one list at a time."
        action={
          <button
            type="button"
            onClick={() => {
              if (isManagingPayments) {
                cancelPaymentEdit();
                setPaymentDraft(EMPTY_PAYMENT_DRAFT);
                setIsAddingPaymentType((current) => !current);
                return;
              }

              cancelProductEdit();
              setProductDraft(EMPTY_PRODUCT_DRAFT);
              setIsAddingProductType((current) => !current);
            }}
            className={
              isManagingPayments
                ? isAddingPaymentType
                  ? SECONDARY_BUTTON_CLASSNAME
                  : PRIMARY_BUTTON_CLASSNAME
                : isAddingProductType
                  ? SECONDARY_BUTTON_CLASSNAME
                  : PRIMARY_BUTTON_CLASSNAME
            }
          >
            {(
              isManagingPayments ? isAddingPaymentType : isAddingProductType
            ) ? (
              <X className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {(isManagingPayments ? isAddingPaymentType : isAddingProductType)
              ? "Cancel"
              : isManagingPayments
                ? "Add payment type"
                : "Add sales detail type"}
          </button>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex rounded-[10px] border border-stroke bg-gray-1 p-1 dark:border-dark-3 dark:bg-dark-2">
              <button
                type="button"
                onClick={() => {
                  setActiveManager("payments");
                  setIsAddingProductType(false);
                  cancelProductEdit();
                }}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium transition ${
                  isManagingPayments
                    ? "bg-white text-dark shadow-1 dark:bg-gray-dark dark:text-white dark:shadow-card"
                    : "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
                }`}
              >
                Payment types
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveManager("products");
                  setIsAddingPaymentType(false);
                  cancelPaymentEdit();
                }}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium transition ${
                  !isManagingPayments
                    ? "bg-white text-dark shadow-1 dark:bg-gray-dark dark:text-white dark:shadow-card"
                    : "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
                }`}
              >
                Sales detail types
              </button>
            </div>

            <p className="text-sm text-dark-5 dark:text-dark-6">
              {isManagingPayments
                ? "Payment types drive the sales log tender dropdown and cash-drawer logic."
                : "Sales detail types shape the net sale, tax, and fee breakdown."}
            </p>
          </div>

          {isManagingPayments ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.paymentMethods.map((method) => (
                    <TableRow
                      key={method.id}
                      className={
                        editingPaymentId === method.id
                          ? "bg-gray-1 dark:bg-dark-2"
                          : undefined
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: method.color }}
                          />
                          <div>
                            <p className="font-medium text-dark dark:text-white">
                              {method.label}
                            </p>
                            <p className="text-xs text-dark-5 dark:text-dark-6">
                              {method.description || "No description"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                        {method.id}
                      </TableCell>
                      <TableCell>
                        {method.countsTowardCash ? (
                          <StatusBadge tone="blue">
                            Counts toward cash drawer
                          </StatusBadge>
                        ) : (
                          <span className="text-sm text-dark-5 dark:text-dark-6">
                            Excluded from drawer total
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={method.enabled ? "green" : "slate"}>
                          {method.enabled ? "Enabled" : "Disabled"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-4">
                          <button
                            type="button"
                            onClick={() => startPaymentEdit(method.id)}
                            className="app-icon-button app-icon-button-accent"
                            aria-label={`Edit ${method.label}`}
                            title={`Edit ${method.label}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removePaymentMethod(method.id)}
                            className="app-icon-button app-danger-icon-button"
                            aria-label={`Remove ${method.label}`}
                            title={`Remove ${method.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sales detail type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.productTypes.map((type) => (
                    <TableRow
                      key={type.id}
                      className={
                        editingProductId === type.id
                          ? "bg-gray-1 dark:bg-dark-2"
                          : undefined
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: type.color }}
                          />
                          <p className="font-medium text-dark dark:text-white">
                            {type.label}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                        {type.id}
                      </TableCell>
                      <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                        {type.description || "No description"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={type.enabled ? "green" : "slate"}>
                          {type.enabled ? "Enabled" : "Disabled"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-4">
                          <button
                            type="button"
                            onClick={() => startProductEdit(type.id)}
                            className="app-icon-button app-icon-button-accent"
                            aria-label={`Edit ${type.label}`}
                            title={`Edit ${type.label}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeProductType(type.id)}
                            className="app-icon-button app-danger-icon-button"
                            aria-label={`Remove ${type.label}`}
                            title={`Remove ${type.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      </SectionCard>

      {/* Modals for editing */}
      {editingPaymentId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={cancelPaymentEdit}
          />
          <div
            className={`${DASHED_PANEL_CLASSNAME} relative z-10 mx-4 w-full max-w-2xl bg-white text-dark dark:bg-dark-2 dark:text-white`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-dark dark:text-white">
                  Edit payment type
                </p>
                <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  Code: {editingPaymentId}
                </p>
              </div>
              <button
                type="button"
                onClick={cancelPaymentEdit}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Label</span>
                <input
                  type="text"
                  value={editingPaymentDraft.label}
                  onChange={(event) =>
                    setEditingPaymentDraft((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Accent color</span>
                <div className={COLOR_INPUT_WRAPPER_CLASSNAME}>
                  <input
                    type="color"
                    value={editingPaymentDraft.color}
                    onChange={(event) =>
                      setEditingPaymentDraft((current) => ({
                        ...current,
                        color: event.target.value,
                      }))
                    }
                    className="h-10 w-12 rounded border-0 bg-transparent p-0"
                  />
                  <span className="text-sm text-dark-5 dark:text-dark-6">
                    {editingPaymentDraft.color}
                  </span>
                </div>
              </label>

              <label className="block md:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Description</span>
                <input
                  type="text"
                  value={editingPaymentDraft.description}
                  onChange={(event) =>
                    setEditingPaymentDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <label className={TOGGLE_PILL_CLASSNAME}>
                <input
                  type="checkbox"
                  checked={editingPaymentDraft.enabled}
                  onChange={(event) =>
                    setEditingPaymentDraft((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                Enabled in sales log
              </label>

              <label className={TOGGLE_PILL_CLASSNAME}>
                <input
                  type="checkbox"
                  checked={editingPaymentDraft.countsTowardCash}
                  onChange={(event) =>
                    setEditingPaymentDraft((current) => ({
                      ...current,
                      countsTowardCash: event.target.checked,
                    }))
                  }
                />
                Counts toward cash drawer
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={savePaymentEdit}
                className={PRIMARY_BUTTON_CLASSNAME}
              >
                <Save className="h-4 w-4" />
                Apply changes
              </button>
              <button
                type="button"
                onClick={cancelPaymentEdit}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingProductId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={cancelProductEdit}
          />
          <div
            className={`${DASHED_PANEL_CLASSNAME} relative z-10 mx-4 w-full max-w-2xl bg-white text-dark dark:bg-dark-2 dark:text-white`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-dark dark:text-white">
                  Edit sales detail type
                </p>
                <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  Code: {editingProductId}
                </p>
              </div>
              <button
                type="button"
                onClick={cancelProductEdit}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Label</span>
                <input
                  type="text"
                  value={editingProductDraft.label}
                  onChange={(event) =>
                    setEditingProductDraft((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Accent color</span>
                <div className={COLOR_INPUT_WRAPPER_CLASSNAME}>
                  <input
                    type="color"
                    value={editingProductDraft.color}
                    onChange={(event) =>
                      setEditingProductDraft((current) => ({
                        ...current,
                        color: event.target.value,
                      }))
                    }
                    className="h-10 w-12 rounded border-0 bg-transparent p-0"
                  />
                  <span className="text-sm text-dark-5 dark:text-dark-6">
                    {editingProductDraft.color}
                  </span>
                </div>
              </label>

              <label className="block md:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Description</span>
                <input
                  type="text"
                  value={editingProductDraft.description}
                  onChange={(event) =>
                    setEditingProductDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className={INPUT_CLASSNAME}
                />
              </label>
            </div>

            <div className="mt-4">
              <label className={TOGGLE_PILL_CLASSNAME}>
                <input
                  type="checkbox"
                  checked={editingProductDraft.enabled}
                  onChange={(event) =>
                    setEditingProductDraft((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                Enabled in sales log
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveProductEdit}
                className={PRIMARY_BUTTON_CLASSNAME}
              >
                <Save className="h-4 w-4" />
                Apply changes
              </button>
              <button
                type="button"
                onClick={cancelProductEdit}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddingPaymentType ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={() => {
              setIsAddingPaymentType(false);
              setPaymentDraft(EMPTY_PAYMENT_DRAFT);
            }}
          />
          <div
            className={`${DASHED_PANEL_CLASSNAME} relative z-10 mx-4 w-full max-w-2xl bg-white text-dark dark:bg-dark-2 dark:text-white`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-dark dark:text-white">
                  Add payment type
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddingPaymentType(false);
                  setPaymentDraft(EMPTY_PAYMENT_DRAFT);
                }}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Label</span>
                <input
                  type="text"
                  value={paymentDraft.label}
                  onChange={(event) =>
                    setPaymentDraft((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  placeholder="Example: Gift Card"
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Accent color</span>
                <div className={COLOR_INPUT_WRAPPER_CLASSNAME}>
                  <input
                    type="color"
                    value={paymentDraft.color}
                    onChange={(event) =>
                      setPaymentDraft((current) => ({
                        ...current,
                        color: event.target.value,
                      }))
                    }
                    className="h-10 w-12 rounded border-0 bg-transparent p-0"
                  />
                  <span className="text-sm text-dark-5 dark:text-dark-6">
                    {paymentDraft.color}
                  </span>
                </div>
              </label>

              <label className="block md:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Description</span>
                <input
                  type="text"
                  value={paymentDraft.description}
                  onChange={(event) =>
                    setPaymentDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Where or how this payment is collected"
                  className={INPUT_CLASSNAME}
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <label className={TOGGLE_PILL_CLASSNAME}>
                <input
                  type="checkbox"
                  checked={paymentDraft.enabled}
                  onChange={(event) =>
                    setPaymentDraft((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                Enabled immediately
              </label>

              <label className={TOGGLE_PILL_CLASSNAME}>
                <input
                  type="checkbox"
                  checked={paymentDraft.countsTowardCash}
                  onChange={(event) =>
                    setPaymentDraft((current) => ({
                      ...current,
                      countsTowardCash: event.target.checked,
                    }))
                  }
                />
                Counts toward cash drawer
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={addPaymentMethod}
                className={PRIMARY_BUTTON_CLASSNAME}
              >
                <Plus className="h-4 w-4" />
                Add payment type
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingPaymentType(false);
                  setPaymentDraft(EMPTY_PAYMENT_DRAFT);
                }}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddingProductType ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={() => {
              setIsAddingProductType(false);
              setProductDraft(EMPTY_PRODUCT_DRAFT);
            }}
          />
          <div
            className={`${DASHED_PANEL_CLASSNAME} relative z-10 mx-4 w-full max-w-2xl bg-white text-dark dark:bg-dark-2 dark:text-white`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-dark dark:text-white">
                  Add sales detail type
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddingProductType(false);
                  setProductDraft(EMPTY_PRODUCT_DRAFT);
                }}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Label</span>
                <input
                  type="text"
                  value={productDraft.label}
                  onChange={(event) =>
                    setProductDraft((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  placeholder="Example: Fuel surcharge"
                  className={INPUT_CLASSNAME}
                />
              </label>

              <label className="block">
                <span className={FIELD_LABEL_CLASSNAME}>Accent color</span>
                <div className={COLOR_INPUT_WRAPPER_CLASSNAME}>
                  <input
                    type="color"
                    value={productDraft.color}
                    onChange={(event) =>
                      setProductDraft((current) => ({
                        ...current,
                        color: event.target.value,
                      }))
                    }
                    className="h-10 w-12 rounded border-0 bg-transparent p-0"
                  />
                  <span className="text-sm text-dark-5 dark:text-dark-6">
                    {productDraft.color}
                  </span>
                </div>
              </label>

              <label className="block md:col-span-2">
                <span className={FIELD_LABEL_CLASSNAME}>Description</span>
                <input
                  type="text"
                  value={productDraft.description}
                  onChange={(event) =>
                    setProductDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="What should staff file under this detail?"
                  className={INPUT_CLASSNAME}
                />
              </label>
            </div>

            <div className="mt-4">
              <label className={TOGGLE_PILL_CLASSNAME}>
                <input
                  type="checkbox"
                  checked={productDraft.enabled}
                  onChange={(event) =>
                    setProductDraft((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                Enabled immediately
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={addProductType}
                className={PRIMARY_BUTTON_CLASSNAME}
              >
                <Plus className="h-4 w-4" />
                Add sales detail type
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingProductType(false);
                  setProductDraft(EMPTY_PRODUCT_DRAFT);
                }}
                className={SECONDARY_BUTTON_CLASSNAME}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
