"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DailyTransaction } from "@/types/erp.types";
import { useAuth } from "@/contexts/AuthContext";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { useStore } from "@/contexts/StoreContext";
import {
  createDefaultStoreSettings,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PRODUCT_TYPES,
  formatSettingLabel,
  PAYMENT_ENTRY_SENTINEL,
  type StorePaymentMethodSetting,
  type StoreProductTypeSetting,
} from "@/lib/store-settings";
import { getTodayIsoDateInTimeZone, toIsoDateKey } from "@/lib/date-time";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle,
  CreditCard,
  DollarSign,
  FileText,
  History,
  Lock,
  Plus,
  Receipt,
  Save,
  Tag,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";

interface LogEntry {
  id: string;
  type: "payment" | "product";
  category: string;
  amount: number;
  description?: string;
  timestamp: Date;
  reconciled: boolean;
}

function formatCurrencyValue(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
}

function getPaymentMethodLabel(
  methods: StorePaymentMethodSetting[],
  value: string,
) {
  return (
    methods.find((method) => method.id === value)?.label ??
    formatSettingLabel(value)
  );
}

function getProductTypeLabel(
  productTypes: StoreProductTypeSetting[],
  value: string,
) {
  return (
    productTypes.find((type) => type.id === value)?.label ??
    formatSettingLabel(value)
  );
}

function toDateKey(value?: string | null) {
  return toIsoDateKey(value);
}

function toLogEntry(entry: DailyTransaction): LogEntry {
  const isPayment = entry.productType === PAYMENT_ENTRY_SENTINEL;

  return {
    id: entry.id,
    type: isPayment ? "payment" : "product",
    category: isPayment ? entry.paymentMethod : entry.productType,
    amount: entry.amount,
    description: entry.description,
    timestamp: entry.date ? new Date(entry.date) : new Date(),
    reconciled: entry.reconciled,
  };
}

function DailySalesEntryContent() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { notify } = useAppNotifications();
  const {
    activeStore,
    isAdmin: isStoreAdmin,
    isLoading: isStoreLoading,
    needsSelection,
  } = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const [salesDeskSettings, setSalesDeskSettings] = useState(() =>
    createDefaultStoreSettings("fallback"),
  );
  const todayKey = useMemo(
    () => getTodayIsoDateInTimeZone(salesDeskSettings.profile.timezone),
    [salesDeskSettings.profile.timezone],
  );
  const normalizedDateParam = useMemo(() => toDateKey(dateParam), [dateParam]);
  const isAdmin = user?.role === "admin";
  const [activeTab, setActiveTab] = useState<"log" | "closeout">("log");
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [entryMode, setEntryMode] = useState<"payment" | "product">("payment");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [hasResolvedDateAccess, setHasResolvedDateAccess] = useState(false);
  const [isClosedOut, setIsClosedOut] = useState(false);
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logFormData, setLogFormData] = useState({
    amount: "",
    category: "cash",
    description: "",
  });
  const [closeoutForm, setCloseoutForm] = useState({
    openingFloat: 500,
    closingFloat: 500,
    cashCounted: 0,
    totalPayouts: 0,
    notes: "",
  });

  useEffect(() => {
    if (!isStoreLoading && isStoreAdmin && needsSelection) {
      router.replace("/admin/store-selection");
    }
  }, [isStoreAdmin, isStoreLoading, needsSelection, router]);

  const showNotify = useCallback(
    (type: "success" | "error", message: string) => {
      notify({ type, message, durationMs: 3000 });
    },
    [notify],
  );

  const enabledPaymentMethods = useMemo(
    () => salesDeskSettings.paymentMethods.filter((method) => method.enabled),
    [salesDeskSettings.paymentMethods],
  );
  const enabledProductTypes = useMemo(
    () => salesDeskSettings.productTypes.filter((type) => type.enabled),
    [salesDeskSettings.productTypes],
  );
  const currencyCode = salesDeskSettings.profile.currency || "USD";
  const defaultPaymentCategory =
    enabledPaymentMethods[0]?.id ?? DEFAULT_PAYMENT_METHODS[0].id;
  const defaultProductCategory =
    enabledProductTypes[0]?.id ?? DEFAULT_PRODUCT_TYPES[0].id;
  const availablePaymentMethods = useMemo(() => {
    const options = [...enabledPaymentMethods];

    if (!editingId) {
      return options;
    }

    const configuredMethod = salesDeskSettings.paymentMethods.find(
      (method) => method.id === logFormData.category,
    );

    if (
      configuredMethod &&
      !options.some((method) => method.id === configuredMethod.id)
    ) {
      options.push(configuredMethod);
      return options;
    }

    if (
      logFormData.category &&
      !options.some((method) => method.id === logFormData.category)
    ) {
      options.push({
        id: logFormData.category,
        label: formatSettingLabel(logFormData.category),
        description: "Legacy payment type",
        color: "#475569",
        enabled: false,
        countsTowardCash: false,
      });
    }

    return options;
  }, [
    editingId,
    enabledPaymentMethods,
    logFormData.category,
    salesDeskSettings.paymentMethods,
  ]);
  const availableProductTypes = useMemo(() => {
    const options = [...enabledProductTypes];

    if (!editingId) {
      return options;
    }

    const configuredType = salesDeskSettings.productTypes.find(
      (type) => type.id === logFormData.category,
    );

    if (
      configuredType &&
      !options.some((type) => type.id === configuredType.id)
    ) {
      options.push(configuredType);
      return options;
    }

    if (
      logFormData.category &&
      !options.some((type) => type.id === logFormData.category)
    ) {
      options.push({
        id: logFormData.category,
        label: formatSettingLabel(logFormData.category),
        description: "Legacy sales detail type",
        color: "#475569",
        enabled: false,
      });
    }

    return options;
  }, [
    editingId,
    enabledProductTypes,
    logFormData.category,
    salesDeskSettings.productTypes,
  ]);
  const hasPaymentOptions = availablePaymentMethods.length > 0;
  const hasProductOptions = availableProductTypes.length > 0;
  const activeModeHasOptions =
    entryMode === "payment" ? hasPaymentOptions : hasProductOptions;

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (!activeStore?.storeKey) {
      setSalesDeskSettings(createDefaultStoreSettings("fallback"));
      return;
    }

    let isMounted = true;

    async function loadSalesDeskSettings() {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload.error ?? "Failed to load sales desk settings",
          );
        }

        if (isMounted) {
          setSalesDeskSettings(payload);
        }
      } catch (error) {
        console.error(error);
      }
    }

    void loadSalesDeskSettings();

    return () => {
      isMounted = false;
    };
  }, [activeStore?.storeKey, isAuthLoading]);

  useEffect(() => {
    if (entryMode === "payment") {
      if (availablePaymentMethods.length === 0) {
        return;
      }

      if (
        !availablePaymentMethods.some(
          (method) => method.id === logFormData.category,
        )
      ) {
        setLogFormData((current) => ({
          ...current,
          category: defaultPaymentCategory,
        }));
      }

      return;
    }

    if (availableProductTypes.length === 0) {
      return;
    }

    if (
      !availableProductTypes.some((type) => type.id === logFormData.category)
    ) {
      setLogFormData((current) => ({
        ...current,
        category: defaultProductCategory,
      }));
    }
  }, [
    availablePaymentMethods,
    availableProductTypes,
    defaultPaymentCategory,
    defaultProductCategory,
    entryMode,
    logFormData.category,
  ]);

  useEffect(() => {
    if (isClosedOut) {
      return;
    }

    setCloseoutForm({
      openingFloat: salesDeskSettings.cashManagement.openingFloat,
      closingFloat: salesDeskSettings.cashManagement.closingFloat,
      cashCounted: 0,
      totalPayouts: 0,
      notes: "",
    });
  }, [
    activeStore?.storeKey,
    salesDeskSettings.cashManagement.closingFloat,
    salesDeskSettings.cashManagement.openingFloat,
    selectedDate,
    isClosedOut,
  ]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (isAdmin && normalizedDateParam) {
      setSelectedDate(normalizedDateParam);
      setHasResolvedDateAccess(true);
      return;
    }

    setSelectedDate(todayKey);
    setHasResolvedDateAccess(true);

    if (!isAdmin && normalizedDateParam && normalizedDateParam !== todayKey) {
      showNotify("error", "Employees can only log today's sales.");

      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.delete("date");

      const nextUrl = nextSearchParams.toString()
        ? `${pathname}?${nextSearchParams.toString()}`
        : pathname;

      router.replace(nextUrl, { scroll: false });
    }
  }, [
    isAdmin,
    isAuthLoading,
    normalizedDateParam,
    pathname,
    router,
    searchParams,
    showNotify,
    todayKey,
  ]);

  const loadEntries = useCallback(async () => {
    if (!hasResolvedDateAccess || !activeStore?.storeKey) {
      setEntries([]);
      setIsClosedOut(false);
      return;
    }

    setIsLoadingEntries(true);

    try {
      const response = await fetch(
        `/api/sales?date=${selectedDate}&includeReconciliations=true`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to load sales entries");
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Expected JSON but received:", text.slice(0, 200));
        throw new Error("Server returned an invalid response format");
      }

      const data = await response.json();
      const payload: DailyTransaction[] = Array.isArray(data)
        ? data
        : data.transactions || [];
      const closedOutStatus = Array.isArray(data) ? false : !!data.isClosedOut;
      const reconciliationRow = Array.isArray(data)
        ? null
        : (data.reconciliations?.[0] ?? null);

      setEntries(
        payload
          .map(toLogEntry)
          .sort(
            (left, right) =>
              right.timestamp.getTime() - left.timestamp.getTime(),
          ),
      );
      setIsClosedOut(closedOutStatus);

      if (reconciliationRow) {
        setCloseoutForm({
          openingFloat: Number(reconciliationRow.openingFloat ?? 0),
          closingFloat: Number(reconciliationRow.closingFloat ?? 0),
          cashCounted: Number(reconciliationRow.cashCounted ?? 0),
          totalPayouts: Number(reconciliationRow.totalPayouts ?? 0),
          notes: reconciliationRow.notes ?? "",
        });
      }
    } catch (error) {
      console.error(error);
      showNotify("error", "Unable to load sales entries");
    } finally {
      setIsLoadingEntries(false);
    }
  }, [activeStore?.storeKey, hasResolvedDateAccess, selectedDate, showNotify]);

  useEffect(() => {
    if (!hasResolvedDateAccess) {
      return;
    }

    void loadEntries();
  }, [hasResolvedDateAccess, loadEntries]);

  const canModifyClosedOutDay = isAdmin && isClosedOut;
  const isSalesDeskLocked = isClosedOut && !canModifyClosedOutDay;
  const canModifySalesEntries = !isClosedOut || canModifyClosedOutDay;

  const handleDeleteEntry = async (entry: LogEntry) => {
    if (entry.reconciled && !canModifyClosedOutDay) {
      showNotify(
        "error",
        "Reconciled sales entries cannot be reversed. Record a new offsetting log on the correct business day instead.",
      );
      return;
    }

    if (isClosedOut && !canModifyClosedOutDay) {
      showNotify("error", "Cannot reverse entries from a closed-out day.");
      return;
    }

    if (
      !confirm(
        `Reverse this entry with an offsetting log? The original record will stay in place for audit purposes.`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/sales?id=${entry.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        showNotify(
          "error",
          payload?.message || "Failed to reverse sales entry",
        );
        return;
      }

      showNotify("success", payload?.message || "Entry reversed successfully");
      await loadEntries();
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error ? error.message : "Unable to reverse entry",
      );
    }
  };

  const totals = useMemo(() => {
    const hasPaymentLogs = entries.some((entry) => entry.type === "payment");
    const hasProductLogs = entries.some((entry) => entry.type === "product");
    const paymentBreakdown = entries
      .filter((entry) => entry.type === "payment")
      .reduce(
        (acc, entry) => {
          acc[entry.category] = (acc[entry.category] ?? 0) + entry.amount;
          return acc;
        },
        {} as Record<string, number>,
      );

    const totalByPayment = Object.values(paymentBreakdown).reduce(
      (sum, value) => sum + value,
      0,
    );
    const totalByProduct = entries
      .filter((entry) => entry.type === "product")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const cash = Object.entries(paymentBreakdown).reduce(
      (sum, [id, amount]) => {
        const method = salesDeskSettings.paymentMethods.find(
          (item) => item.id === id,
        );
        return method?.countsTowardCash ? sum + amount : sum;
      },
      0,
    );
    const cashless = totalByPayment - cash;
    const totalsAligned = Math.abs(totalByPayment - totalByProduct) <= 0.01;
    const canCloseout = hasPaymentLogs && hasProductLogs && totalsAligned;

    const productBreakdown = entries
      .filter((entry) => entry.type === "product")
      .reduce(
        (acc, entry) => {
          acc[entry.category] = (acc[entry.category] ?? 0) + entry.amount;
          return acc;
        },
        {} as Record<string, number>,
      );

    return {
      cash,
      cashless,
      totalByPayment,
      totalByProduct,
      paymentBreakdown,
      productBreakdown,
      canCloseout,
    };
  }, [entries, salesDeskSettings.paymentMethods]);

  const reconciliation = useMemo(() => {
    const expectedCash =
      closeoutForm.openingFloat + totals.cash - closeoutForm.totalPayouts;
    const variance = expectedCash - closeoutForm.cashCounted;
    const bankDeposit = closeoutForm.cashCounted - closeoutForm.closingFloat;

    return { expectedCash, variance, bankDeposit };
  }, [closeoutForm, totals.cash]);

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isClosedOut && !canModifyClosedOutDay) {
      showNotify("error", "This day is already closed out.");
      return;
    }

    if (!logFormData.amount || isNaN(Number(logFormData.amount))) {
      showNotify("error", "Please enter a valid amount");
      return;
    }

    if (!activeModeHasOptions) {
      showNotify(
        "error",
        entryMode === "payment"
          ? "Enable at least one payment type in Admin Settings before logging totals."
          : "Enable at least one sales detail type in Admin Settings before logging totals.",
      );
      return;
    }

    setIsSaving(true);

    try {
      const url = "/api/sales";
      const method = editingId ? "PUT" : "POST";
      const body = {
        id: editingId || undefined,
        date: selectedDate,
        amount: Number(logFormData.amount),
        paymentMethod: entryMode === "payment" ? logFormData.category : "other",
        productType:
          entryMode === "payment"
            ? PAYMENT_ENTRY_SENTINEL
            : logFormData.category,
        description: logFormData.description,
        userId: user?.id,
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.message ||
            `Failed to ${editingId ? "update" : "save"} sales entry`,
        );
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned an invalid response format");
      }

      const savedEntry: DailyTransaction = await response.json();
      const newEntry = toLogEntry(savedEntry);

      if (editingId) {
        setEntries((prev) =>
          prev
            .map((item) => (item.id === editingId ? newEntry : item))
            .sort(
              (left, right) =>
                right.timestamp.getTime() - left.timestamp.getTime(),
            ),
        );
        setEditingId(null);
      } else {
        setEntries((prev) =>
          [newEntry, ...prev].sort(
            (left, right) =>
              right.timestamp.getTime() - left.timestamp.getTime(),
          ),
        );
      }

      setLogFormData((prev) => ({ ...prev, amount: "", description: "" }));

      const label =
        entryMode === "payment"
          ? getPaymentMethodLabel(
              salesDeskSettings.paymentMethods,
              logFormData.category,
            )
          : getProductTypeLabel(
              salesDeskSettings.productTypes,
              logFormData.category,
            );

      showNotify(
        "success",
        `${editingId ? "Updated" : "Logged"} ${formatCurrencyValue(Number(logFormData.amount), currencyCode)} for ${label}`,
      );
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error ? error.message : "Failed to save entry",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isClosedOut && !canModifyClosedOutDay) {
      showNotify("error", "This day is already closed out.");
      return;
    }

    if (!totals.canCloseout) {
      showNotify(
        "error",
        "Requirement: payment totals and sales details must be logged first.",
      );
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/sales", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reconciliationData: {
            date: selectedDate,
            openingFloat: closeoutForm.openingFloat,
            closingFloat: closeoutForm.closingFloat,
            cashCounted: closeoutForm.cashCounted,
            totalPayouts: closeoutForm.totalPayouts,
            totalCashSales: totals.cash,
            totalCardSales: totals.cashless,
            totalExpected: reconciliation.expectedCash,
            totalActual: closeoutForm.cashCounted,
            productBreakdown: totals.productBreakdown,
            reconciliedBy: user?.id || "system",
            notes: closeoutForm.notes,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || "Failed to submit closeout");
      }

      // No need to parse response body for PATCH as we call loadEntries() next
      await loadEntries();
      showNotify("success", "Daily closeout submitted and reconciled");
    } catch (error) {
      console.error(error);
      showNotify(
        "error",
        error instanceof Error ? error.message : "Failed to submit closeout",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditEntry = (entry: LogEntry) => {
    setEditingId(entry.id);
    setEntryMode(entry.type);
    setLogFormData({
      amount: entry.amount.toString(),
      category: entry.category,
      description: entry.description || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const paymentSummaryItems = useMemo(() => {
    const configuredItems = salesDeskSettings.paymentMethods.map((method) => ({
      id: method.id,
      label: method.label,
      amount: totals.paymentBreakdown[method.id] ?? 0,
      color: method.color,
      enabled: method.enabled,
    }));
    const extraItems = Object.keys(totals.paymentBreakdown)
      .filter((id) => !configuredItems.some((item) => item.id === id))
      .map((id) => ({
        id,
        label: formatSettingLabel(id),
        amount: totals.paymentBreakdown[id] ?? 0,
        color: "#475569",
        enabled: false,
      }));

    return [...configuredItems, ...extraItems].filter(
      (item) => item.enabled || item.amount > 0,
    );
  }, [salesDeskSettings.paymentMethods, totals.paymentBreakdown]);

  const productSummaryItems = useMemo(() => {
    const configuredItems = salesDeskSettings.productTypes.map((type) => ({
      id: type.id,
      label: type.label,
      amount: totals.productBreakdown[type.id] ?? 0,
      color: type.color,
      enabled: type.enabled,
    }));
    const extraItems = Object.keys(totals.productBreakdown)
      .filter((id) => !configuredItems.some((item) => item.id === id))
      .map((id) => ({
        id,
        label: formatSettingLabel(id),
        amount: totals.productBreakdown[id] ?? 0,
        color: "#475569",
        enabled: false,
      }));

    return [...configuredItems, ...extraItems].filter(
      (item) => item.enabled || item.amount > 0,
    );
  }, [salesDeskSettings.productTypes, totals.productBreakdown]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="font-satoshi text-3xl font-bold text-dark dark:text-white">
              Daily Sales Desk
            </h1>
            <p className="font-satoshi mt-2 text-gray-6">
              Manage payment totals, net sale, tax, and fees
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-dark-5">
              {isAdmin ? "Select Date" : "Today Only"}
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              min={!isAdmin ? todayKey : undefined}
              max={!isAdmin ? todayKey : undefined}
              disabled={!isAdmin}
              className="rounded-lg border border-stroke bg-white px-3 py-1.5 text-sm font-bold text-dark outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-gray-1 disabled:text-dark-5 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:disabled:bg-dark-3 dark:disabled:text-dark-6"
            />
          </div>
        </div>
        <div className="flex gap-2 rounded-full border border-stroke bg-white p-1 shadow-sm dark:border-dark-3 dark:bg-dark-2">
          <button
            onClick={() => setActiveTab("log")}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
              activeTab === "log"
                ? "bg-primary text-white shadow-lg"
                : "text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
            }`}
          >
            <Receipt className="h-4 w-4" />
            Log Totals
          </button>
          <button
            onClick={() => {
              if (totals.canCloseout || isClosedOut) {
                setActiveTab("closeout");
              } else {
                showNotify(
                  "error",
                  "Payment totals and sales details must both be logged and match before closeout",
                );
              }
            }}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
              activeTab === "closeout"
                ? "bg-primary text-white shadow-lg"
                : !totals.canCloseout && !isClosedOut
                  ? "cursor-not-allowed text-gray-4 opacity-50"
                  : "text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
            }`}
          >
            {isClosedOut ? (
              <Lock className="h-4 w-4" />
            ) : totals.canCloseout ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {isClosedOut
              ? canModifyClosedOutDay
                ? "Edit Closeout"
                : "Day Closed"
              : "Daily Closeout"}
          </button>
        </div>
      </div>

      {activeStore ? (
        <div className="mb-6 inline-flex items-center rounded-full bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {activeStore.name}
        </div>
      ) : null}

      {activeTab === "log" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
            {isClosedOut && (
              <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-primary">
                <Lock className="h-5 w-5" />
                <div>
                  <p className="text-sm font-bold">Day Closed Out</p>
                  <p className="text-xs opacity-80">
                    {canModifyClosedOutDay
                      ? "Admin override is active for this reconciled day."
                      : "This day has been reconciled and locked."}
                  </p>
                </div>
              </div>
            )}

            <div
              className={`rounded-[28px] border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2 ${isSalesDeskLocked ? "pointer-events-none opacity-50" : ""}`}
            >
              <h2 className="font-satoshi mb-6 flex items-center justify-between text-xl font-bold text-dark dark:text-white">
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-primary" />
                  {editingId ? "Edit Daily Total" : "Add Daily Total"}
                </div>
                {editingId && (
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setLogFormData({
                        amount: "",
                        category:
                          entryMode === "payment"
                            ? defaultPaymentCategory
                            : defaultProductCategory,
                        description: "",
                      });
                    }}
                    className="text-xs font-bold text-red hover:underline"
                  >
                    Cancel Edit
                  </button>
                )}
              </h2>

              <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg bg-gray-2 p-1 dark:bg-dark-3">
                <button
                  onClick={() => {
                    setEntryMode("payment");
                    setLogFormData({
                      ...logFormData,
                      category: defaultPaymentCategory,
                    });
                  }}
                  className={`flex items-center justify-center gap-2 rounded-md py-2 text-xs font-bold transition-all ${
                    entryMode === "payment"
                      ? "bg-white text-primary shadow-sm dark:bg-dark-2"
                      : "text-dark-5"
                  }`}
                >
                  <DollarSign className="h-3 w-3" />
                  BY PAYMENT
                </button>
                <button
                  onClick={() => {
                    setEntryMode("product");
                    setLogFormData({
                      ...logFormData,
                      category: defaultProductCategory,
                    });
                  }}
                  className={`flex items-center justify-center gap-2 rounded-md py-2 text-xs font-bold transition-all ${
                    entryMode === "product"
                      ? "bg-white text-primary shadow-sm dark:bg-dark-2"
                      : "text-dark-5"
                  }`}
                >
                  <Tag className="h-3 w-3" />
                  SALES DETAIL
                </button>
              </div>

              <form onSubmit={handleLogSubmit} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-dark-5 dark:text-dark-6">
                    Total Amount ({currencyCode})
                  </label>
                  <CurrencyInput
                    name="amount"
                    value={logFormData.amount}
                    currency={currencyCode}
                    onValueChange={(decimalValue) =>
                      setLogFormData({ ...logFormData, amount: decimalValue })
                    }
                    placeholder="0.00"
                    className="w-full rounded-xl border border-stroke bg-transparent px-4 py-2.5 text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-dark-5 dark:text-dark-6">
                    {entryMode === "payment"
                      ? "Payment Method"
                      : "Sales Detail"}
                  </label>
                  <select
                    value={logFormData.category}
                    onChange={(e) =>
                      setLogFormData({
                        ...logFormData,
                        category: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-stroke bg-transparent px-4 py-2.5 text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                    disabled={!activeModeHasOptions}
                  >
                    {!activeModeHasOptions ? (
                      <option value="">
                        {entryMode === "payment"
                          ? "No enabled payment types"
                          : "No enabled sales detail types"}
                      </option>
                    ) : entryMode === "payment" ? (
                      availablePaymentMethods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.label}
                          {!method.enabled ? " (disabled)" : ""}
                        </option>
                      ))
                    ) : (
                      availableProductTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                          {!type.enabled ? " (disabled)" : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                {!activeModeHasOptions ? (
                  <div className="border-amber/30 bg-amber/5 text-amber rounded-lg border p-3 text-xs">
                    {entryMode === "payment"
                      ? "No payment types are enabled. Add or enable one in Admin Settings before logging payment totals."
                      : "No sales detail types are enabled. Add or enable one in Admin Settings before logging sales details."}
                  </div>
                ) : null}
                <div>
                  <label className="mb-2 block text-sm font-medium text-dark-5 dark:text-dark-6">
                    Notes
                  </label>
                  <textarea
                    value={logFormData.description}
                    onChange={(e) =>
                      setLogFormData({
                        ...logFormData,
                        description: e.target.value,
                      })
                    }
                    placeholder="Optional notes..."
                    rows={2}
                    className="w-full rounded-xl border border-stroke bg-transparent px-4 py-2.5 text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSaving || !activeModeHasOptions}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-5 w-5" />
                  {editingId ? "Update Total" : "Save Total"}
                </button>
              </form>
            </div>

            <div className="rounded-[28px] border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
              <h3 className="font-satoshi mb-4 text-lg font-bold text-dark dark:text-white">
                Payment Summary
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-green/5 p-3">
                  <div className="flex items-center gap-3 text-green">
                    <DollarSign className="h-5 w-5" />
                    <span className="text-sm font-medium">
                      Cash Drawer Total
                    </span>
                  </div>
                  <span className="font-bold text-dark dark:text-white">
                    {formatCurrencyValue(totals.cash, currencyCode)}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-blue/5 p-3">
                  <div className="flex items-center gap-3 text-blue">
                    <CreditCard className="h-5 w-5" />
                    <span className="text-sm font-medium">Non-cash Total</span>
                  </div>
                  <span className="font-bold text-dark dark:text-white">
                    {formatCurrencyValue(totals.cashless, currencyCode)}
                  </span>
                </div>
                <div className="space-y-2 rounded-lg border border-stroke bg-gray-1/60 p-3 dark:border-dark-3 dark:bg-dark-3/40">
                  {paymentSummaryItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-dark dark:text-white">
                          {item.label}
                        </span>
                      </div>
                      <span className="font-semibold text-dark dark:text-white">
                        {formatCurrencyValue(item.amount, currencyCode)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-stroke pt-4 dark:border-dark-3">
                  <div className="flex items-center justify-between text-lg font-bold">
                    <span className="text-dark dark:text-white">
                      Total Logged
                    </span>
                    <span className="text-primary">
                      {formatCurrencyValue(totals.totalByPayment, currencyCode)}
                    </span>
                  </div>
                </div>
              </div>

              {!totals.canCloseout && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red/5 p-3">
                  <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-red">
                    <Lock className="h-3 w-3" />
                    Closeout Locked
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-dark-5">
                    You must log payment totals and sales details that reconcile
                    to the same sales amount before Daily Closeout can unlock.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-[28px] border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-satoshi text-xl font-bold text-dark dark:text-white">
                  Sales Detail Totals
                </h2>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-widest text-dark-5">
                    Total Sales Details
                  </p>
                  <p className="text-xl font-black text-primary">
                    {formatCurrencyValue(totals.totalByProduct, currencyCode)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {productSummaryItems.map((type) => {
                  const amount = type.amount;
                  const percentage =
                    totals.totalByProduct > 0
                      ? (amount / totals.totalByProduct) * 100
                      : 0;

                  return (
                    <div
                      key={type.id}
                      className="rounded-xl border border-stroke bg-gray-2 p-4 dark:border-dark-3 dark:bg-dark-3/50"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: type.color }}
                        />
                        <p className="truncate text-xs text-dark-5 dark:text-dark-6">
                          {type.label}
                        </p>
                      </div>
                      <p className="text-lg font-bold text-dark dark:text-white">
                        {formatCurrencyValue(amount, currencyCode)}
                      </p>
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-3 dark:bg-dark-3">
                        <div
                          className="h-full"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: type.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {Math.abs(totals.totalByPayment - totals.totalByProduct) > 0.01 &&
                totals.totalByPayment > 0 &&
                totals.totalByProduct > 0 && (
                  <div className="border-amber/20 bg-amber/5 text-amber mt-6 flex items-center gap-3 rounded-lg border p-3 text-xs font-medium">
                    <AlertCircle className="h-4 w-4" />
                    Warning: Payment totals (
                    {formatCurrencyValue(totals.totalByPayment, currencyCode)})
                    and sales details (
                    {formatCurrencyValue(totals.totalByProduct, currencyCode)})
                    do not match.
                  </div>
                )}
            </div>

            <div className="overflow-hidden rounded-[28px] border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
              <h2 className="font-satoshi mb-6 flex items-center justify-between text-xl font-bold text-dark dark:text-white">
                Daily Entries
                <History className="h-5 w-5 text-dark-5" />
              </h2>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingEntries ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-dark-5 dark:text-dark-6"
                        >
                          Loading sales logs...
                        </TableCell>
                      </TableRow>
                    ) : entries.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-dark-5 dark:text-dark-6"
                        >
                          No totals logged for this date.
                        </TableCell>
                      </TableRow>
                    ) : (
                      entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                entry.type === "payment"
                                  ? "bg-blue/10 text-blue"
                                  : "bg-purple/10 text-purple"
                              }`}
                            >
                              {entry.type === "payment" ? "payment" : "detail"}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm font-semibold">
                            {entry.type === "payment"
                              ? getPaymentMethodLabel(
                                  salesDeskSettings.paymentMethods,
                                  entry.category,
                                )
                              : getProductTypeLabel(
                                  salesDeskSettings.productTypes,
                                  entry.category,
                                )}
                          </TableCell>
                          <TableCell className="text-xs text-dark-5">
                            {entry.description || "-"}
                          </TableCell>
                          <TableCell className="text-right font-bold text-dark dark:text-white">
                            {formatCurrencyValue(entry.amount, currencyCode)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {canModifySalesEntries &&
                                (!entry.reconciled ||
                                  canModifyClosedOutDay) && (
                                <button
                                  onClick={() => handleEditEntry(entry)}
                                  className="text-blue-500 transition-colors hover:text-blue-700"
                                  title="Edit entry"
                                >
                                  <FileText className="h-4 w-4" />
                                </button>
                              )}
                              {canModifySalesEntries &&
                                (!entry.reconciled ||
                                  canModifyClosedOutDay) && (
                                <button
                                  onClick={() => handleDeleteEntry(entry)}
                                  className="text-red-500 transition-colors hover:text-red-700"
                                  title="Reverse entry"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="animate-fade-in grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="rounded-[28px] border border-stroke bg-white p-8 shadow-sm dark:border-dark-3 dark:bg-dark-2">
            <h2 className="font-satoshi mb-8 flex items-center gap-3 text-2xl font-bold text-dark dark:text-white">
              <Wallet className="h-6 w-6 text-primary" />
              End of Day Reconciliation
            </h2>
            <form
              onSubmit={handleCloseoutSubmit}
              className={`space-y-8 ${isSalesDeskLocked ? "pointer-events-none opacity-50" : ""}`}
            >
              {isClosedOut && (
                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-primary">
                  <Lock className="h-5 w-5" />
                  <div>
                    <p className="text-sm font-bold">Closeout Completed</p>
                    <p className="text-xs opacity-80">
                      {canModifyClosedOutDay
                        ? "Admin can update this saved reconciliation."
                        : "Reconciliation has been submitted and locked for today."}
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                    Opening Float ($)
                  </label>
                  <div className="relative">
                    <ArrowUpCircle className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-green" />
                    <CurrencyInput
                      value={closeoutForm.openingFloat}
                      currency={currencyCode}
                      showSymbol={false}
                      onValueChange={(_, numericValue) =>
                        setCloseoutForm({
                          ...closeoutForm,
                          openingFloat: numericValue,
                        })
                      }
                      className="w-full rounded-xl border-2 border-stroke bg-transparent py-3 pl-10 pr-4 text-xl font-bold text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-dark-6">
                    Cash in drawer at start of shift
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                    Closing Float ($)
                  </label>
                  <div className="relative">
                    <ArrowDownCircle className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-blue" />
                    <CurrencyInput
                      value={closeoutForm.closingFloat}
                      currency={currencyCode}
                      showSymbol={false}
                      onValueChange={(_, numericValue) =>
                        setCloseoutForm({
                          ...closeoutForm,
                          closingFloat: numericValue,
                        })
                      }
                      className="w-full rounded-xl border-2 border-stroke bg-transparent py-3 pl-10 pr-4 text-xl font-bold text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-dark-6">
                    Cash kept in drawer for next day
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                    Total Payouts ($)
                  </label>
                  <div className="relative">
                    <ArrowDownCircle className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-red" />
                    <CurrencyInput
                      value={closeoutForm.totalPayouts}
                      currency={currencyCode}
                      showSymbol={false}
                      onValueChange={(_, numericValue) =>
                        setCloseoutForm({
                          ...closeoutForm,
                          totalPayouts: numericValue,
                        })
                      }
                      className="w-full rounded-xl border-2 border-stroke bg-transparent py-3 pl-10 pr-4 text-xl font-bold text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-dark-6">
                    Total cash taken for expenses/purchases
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                    Total Bank Deposit ($)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
                    <input
                      type="text"
                      value={formatCurrencyValue(
                        reconciliation.bankDeposit,
                        currencyCode,
                      )}
                      readOnly
                      className="w-full rounded-xl border-2 border-stroke bg-gray-2 py-3 pl-10 pr-4 text-xl font-bold text-primary outline-none dark:border-dark-3 dark:bg-dark-3"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-dark-6">
                    Amount to be removed from drawer
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-primary/10 bg-primary/5 p-6">
                <label className="mb-4 block text-center text-sm font-bold uppercase tracking-widest text-primary">
                  Physical Cash Counted at Close ($)
                </label>
                <CurrencyInput
                  value={closeoutForm.cashCounted}
                  currency={currencyCode}
                  showSymbol={false}
                  onValueChange={(_, numericValue) =>
                    setCloseoutForm({
                      ...closeoutForm,
                      cashCounted: numericValue,
                    })
                  }
                  className="w-full rounded-xl border-4 border-dashed border-primary/30 bg-white py-6 text-center text-5xl font-black text-primary outline-none transition-all focus:border-primary dark:bg-dark-3"
                  placeholder="0.00"
                />
                <p className="mt-4 text-center text-xs text-primary/60">
                  Count all physical currency in the drawer now
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                  Notes &amp; Discrepancy Explanation
                </label>
                <textarea
                  value={closeoutForm.notes}
                  onChange={(e) =>
                    setCloseoutForm({ ...closeoutForm, notes: e.target.value })
                  }
                  rows={3}
                  className="w-full rounded-xl border-2 border-stroke bg-transparent px-4 py-3 text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                  placeholder="Explain any variance or mention specific payouts..."
                />
              </div>

              <button
                type="submit"
                disabled={isSaving || isSalesDeskLocked}
                className="w-full rounded-xl bg-dark py-4 font-black uppercase tracking-widest text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-dark"
              >
                {isClosedOut
                  ? canModifyClosedOutDay
                    ? "Update Daily Report"
                    : "Report Submitted"
                  : "Finalize & Submit Daily Report"}
              </button>
            </form>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-stroke bg-white p-8 shadow-sm dark:border-dark-3 dark:bg-dark-2">
              <h2 className="font-satoshi mb-6 flex items-center gap-2 text-xl font-bold text-dark dark:text-white">
                <FileText className="h-5 w-5 text-primary" />
                System Calculations
              </h2>
              <div className="space-y-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-dark-5">Opening Cash Float</span>
                  <span className="font-bold text-dark dark:text-white">
                    {formatCurrencyValue(
                      closeoutForm.openingFloat,
                      currencyCode,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-dark-5">Total Cash Sales (Logged)</span>
                  <span className="font-bold text-green">
                    +{formatCurrencyValue(totals.cash, currencyCode)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-dark-5">Total Payouts (Recorded)</span>
                  <span className="font-bold text-red">
                    -
                    {formatCurrencyValue(
                      closeoutForm.totalPayouts,
                      currencyCode,
                    )}
                  </span>
                </div>
                <div className="border-t-2 border-dashed border-stroke pt-4 dark:border-dark-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wider text-dark dark:text-white">
                      Expected Cash in Drawer
                    </span>
                    <span className="text-2xl font-black text-dark dark:text-white">
                      {formatCurrencyValue(
                        reconciliation.expectedCash,
                        currencyCode,
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`rounded-[28px] border-2 p-8 transition-all ${
                reconciliation.variance === 0
                  ? "border-green/20 bg-green/5"
                  : Math.abs(reconciliation.variance) < 10
                    ? "border-amber/20 bg-amber/5"
                    : "border-red/20 bg-red/5"
              }`}
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h3
                    className={`text-lg font-bold ${
                      reconciliation.variance === 0
                        ? "text-green"
                        : Math.abs(reconciliation.variance) < 10
                          ? "text-amber"
                          : "text-red"
                    }`}
                  >
                    {reconciliation.variance === 0
                      ? "Perfect Reconciliation"
                      : "Cash Variance Detected"}
                  </h3>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Difference between physical count and system expectation.
                  </p>
                </div>
                {reconciliation.variance === 0 ? (
                  <CheckCircle className="h-8 w-8 text-green" />
                ) : (
                  <AlertCircle className="h-8 w-8 text-red" />
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-4xl font-black ${
                    reconciliation.variance === 0 ? "text-green" : "text-red"
                  }`}
                >
                  {reconciliation.variance > 0
                    ? "-"
                    : reconciliation.variance < 0
                      ? "+"
                      : ""}
                  {formatCurrencyValue(
                    Math.abs(reconciliation.variance),
                    currencyCode,
                  )}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest text-dark-6">
                  Variance
                </span>
              </div>

              {Math.abs(reconciliation.variance) > 0 && (
                <div className="mt-6 rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-3">
                  <p className="mb-2 text-xs font-bold uppercase text-dark dark:text-white">
                    Action Required:
                  </p>
                  <p className="text-xs leading-relaxed text-dark-5 dark:text-dark-6">
                    Please double-check your physical count. If the variance
                    remains, provide a detailed explanation in the notes section
                    before submitting.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-blue/20 bg-blue/5 p-6">
              <div className="flex gap-4">
                <CreditCard className="h-6 w-6 shrink-0 text-blue" />
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wide text-blue">
                    Non-cash Sales
                  </h4>
                  <p className="mt-1 text-2xl font-black text-dark dark:text-white">
                    {formatCurrencyValue(totals.cashless, currencyCode)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-dark-5">
                    Card, digital, gift card, and other non-cash tenders do not
                    affect physical cash reconciliation. Verify them against
                    your terminal or processor reports.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DailySalesEntryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      }
    >
      <DailySalesEntryContent />
    </Suspense>
  );
}
