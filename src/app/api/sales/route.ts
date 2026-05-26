import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import type {
  DailyReconciliation,
  DailySalesSummary,
  DailyTransaction,
  PaymentMethod,
} from "@/types/erp.types";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import {
  loadStoreSettingsForStore,
  PAYMENT_ENTRY_SENTINEL,
} from "@/lib/store-settings";
import {
  getTodayIsoDateInTimeZone,
  parseStoredDate,
  toIsoDateKey,
} from "@/lib/date-time";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getServerStoreContext } from "@/lib/stores/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type SalesLineType = "payment" | "product";

type DailySalesSummaryRow = {
  id: string;
  business_date: string;
  gross_sales: number | string;
  payment_total: number | string;
  product_total: number | string;
  cash_sales: number | string;
  cashless_sales: number | string;
  line_count: number | null;
  payment_breakdown: Record<string, number | string> | null;
  product_breakdown: Record<string, number | string> | null;
  reconciled: boolean;
  reconciled_by: string | null;
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
};

type DailySalesPaymentLineRow = {
  id: string;
  sales_summary_id: string;
  store_key: string;
  business_date: string;
  amount: number | string;
  payment_method: PaymentMethod;
  description: string | null;
  employee_id: string | null;
  reconciled: boolean;
  reconciled_by: string | null;
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
};

type DailySalesProductLineRow = {
  id: string;
  sales_summary_id: string;
  store_key: string;
  business_date: string;
  amount: number | string;
  product_type: string;
  description: string | null;
  employee_id: string | null;
  reconciled: boolean;
  reconciled_by: string | null;
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
};

type DailySalesReconciliationRow = {
  id: string;
  reconciliation_date: string;
  opening_float: number | string;
  closing_float: number | string;
  cash_counted: number | string;
  total_payouts: number | string;
  total_cash_sales: number | string;
  total_card_sales: number | string;
  total_expected: number | string;
  total_actual: number | string;
  variance: number | string;
  variance_percent: number | string;
  product_breakdown: Record<string, number | string> | null;
  reconciled_by: string | null;
  reconciled_at: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

type NormalizedSalesLine = {
  lineType: SalesLineType;
  lineId: string;
  summaryId: string;
  storeKey: string;
  businessDate: string;
  amount: number;
  description: string | null;
  employeeId: string | null;
  reconciled: boolean;
  reconciledBy: string | null;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentMethod?: string;
  productType?: string;
};

type SalesDayTotals = {
  grossSales: number;
  paymentTotal: number;
  productTotal: number;
  cashSales: number;
  cashlessSales: number;
  lineCount: number;
  paymentBreakdown: Record<string, number>;
  productBreakdown: Record<string, number>;
};

const SUMMARY_SELECT =
  "id,business_date,gross_sales,payment_total,product_total,cash_sales,cashless_sales,line_count,payment_breakdown,product_breakdown,reconciled,reconciled_by,reconciled_at,created_at,updated_at";
const PAYMENT_LINE_SELECT =
  "id,sales_summary_id,store_key,business_date,amount,payment_method,description,employee_id,reconciled,reconciled_by,reconciled_at,created_at,updated_at";
const PRODUCT_LINE_SELECT =
  "id,sales_summary_id,store_key,business_date,amount,product_type,description,employee_id,reconciled,reconciled_by,reconciled_at,created_at,updated_at";
const RECONCILIATION_SELECT =
  "id,reconciliation_date,opening_float,closing_float,cash_counted,total_payouts,total_cash_sales,total_card_sales,total_expected,total_actual,variance,variance_percent,product_breakdown,reconciled_by,reconciled_at,notes,status,created_at,updated_at";

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function toIsoDate(value?: string | Date | null) {
  return toIsoDateKey(value);
}

function canManageHistoricalSalesLogs(role: string | null) {
  return role === "admin";
}

function createTransactionId(lineType: SalesLineType, lineId: string) {
  return `${lineType}:${lineId}`;
}

function parseTransactionId(transactionId: string) {
  const [lineType, ...idParts] = transactionId.split(":");
  const lineId = idParts.join(":");

  if ((lineType === "payment" || lineType === "product") && lineId) {
    return { lineType, lineId } as const;
  }

  return null;
}

function toBreakdownRecord(
  value: Record<string, number | string> | null | undefined,
) {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, entryValue]) => [
      key,
      toNumber(entryValue),
    ]),
  );
}

function totalsMatch(left: number, right: number) {
  return Math.abs(left - right) <= 0.01;
}

function buildBreakdown<T>(
  lines: T[],
  getKey: (line: T) => string,
  getAmount: (line: T) => number,
) {
  return lines.reduce(
    (acc, line) => {
      const key = getKey(line);
      acc[key] = (acc[key] ?? 0) + getAmount(line);
      return acc;
    },
    {} as Record<string, number>,
  );
}

function buildSalesReversalDescription(
  entry: Pick<DailyTransaction, "id" | "description">,
) {
  const originalDescription = entry.description?.trim();
  return originalDescription
    ? `Reversal of sales entry ${entry.id}: ${originalDescription}`
    : `Reversal of sales entry ${entry.id}`;
}

function isReversalDescription(value: string | null | undefined) {
  return (value ?? "").startsWith("Reversal of sales entry ");
}

function mapPaymentLineRow(line: DailySalesPaymentLineRow): DailyTransaction {
  return {
    id: createTransactionId("payment", line.id),
    date: parseStoredDate(line.business_date),
    amount: toNumber(line.amount),
    paymentMethod: line.payment_method,
    productType: PAYMENT_ENTRY_SENTINEL,
    description: line.description ?? "",
    userId: line.employee_id ?? "system",
    reconciled: line.reconciled,
    reconciledBy: line.reconciled_by ?? undefined,
    reconciledAt: line.reconciled_at
      ? parseStoredDate(line.reconciled_at)
      : undefined,
    createdAt: parseStoredDate(line.created_at),
    updatedAt: parseStoredDate(line.updated_at),
  };
}

function mapProductLineRow(line: DailySalesProductLineRow): DailyTransaction {
  return {
    id: createTransactionId("product", line.id),
    date: parseStoredDate(line.business_date),
    amount: toNumber(line.amount),
    paymentMethod: "other",
    productType: line.product_type,
    description: line.description ?? "",
    userId: line.employee_id ?? "system",
    reconciled: line.reconciled,
    reconciledBy: line.reconciled_by ?? undefined,
    reconciledAt: line.reconciled_at
      ? parseStoredDate(line.reconciled_at)
      : undefined,
    createdAt: parseStoredDate(line.created_at),
    updatedAt: parseStoredDate(line.updated_at),
  };
}

function mapSummaryRow(summary: DailySalesSummaryRow): DailySalesSummary {
  return {
    id: summary.id,
    date: parseStoredDate(summary.business_date),
    grossSales: toNumber(summary.gross_sales),
    paymentTotal: toNumber(summary.payment_total),
    productTotal: toNumber(summary.product_total),
    cashSales: toNumber(summary.cash_sales),
    cashlessSales: toNumber(summary.cashless_sales),
    lineCount: Number(summary.line_count ?? 0),
    paymentBreakdown: toBreakdownRecord(summary.payment_breakdown),
    productBreakdown: toBreakdownRecord(summary.product_breakdown),
    reconciled: summary.reconciled,
    reconciledBy: summary.reconciled_by ?? undefined,
    reconciledAt: summary.reconciled_at
      ? parseStoredDate(summary.reconciled_at)
      : undefined,
    createdAt: parseStoredDate(summary.created_at),
    updatedAt: parseStoredDate(summary.updated_at),
  };
}

function mapReconciliationRow(
  reconciliation: DailySalesReconciliationRow,
): DailyReconciliation {
  return {
    id: reconciliation.id,
    date: parseStoredDate(reconciliation.reconciliation_date),
    openingFloat: toNumber(reconciliation.opening_float),
    closingFloat: toNumber(reconciliation.closing_float),
    cashCounted: toNumber(reconciliation.cash_counted),
    totalPayouts: toNumber(reconciliation.total_payouts),
    totalCashSales: toNumber(reconciliation.total_cash_sales),
    totalCardSales: toNumber(reconciliation.total_card_sales),
    totalExpected: toNumber(reconciliation.total_expected),
    totalActual: toNumber(reconciliation.total_actual),
    variance: toNumber(reconciliation.variance),
    variancePercent: toNumber(reconciliation.variance_percent),
    productBreakdown: toBreakdownRecord(reconciliation.product_breakdown),
    reconciliedBy: reconciliation.reconciled_by ?? "system",
    reconciliedAt: parseStoredDate(reconciliation.reconciled_at),
    notes: reconciliation.notes ?? "",
    status: reconciliation.status,
    createdAt: parseStoredDate(reconciliation.created_at),
    updatedAt: parseStoredDate(reconciliation.updated_at),
  };
}

async function getCurrentUserAccess(supabase: SupabaseClient, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role,full_name,permissions")
    .eq("id", userId)
    .single();

  return {
    role: profile?.role ?? null,
    fullName: profile?.full_name ?? null,
    permissions: profile?.permissions ?? null,
    canAccessSales: canAccessPath(
      "/sales/daily-entry",
      profile?.role,
      profile?.permissions,
    ),
  };
}

function getConfigurationError() {
  return NextResponse.json(
    { message: "Supabase configuration required" },
    { status: 503 },
  );
}

async function getActiveStoreKey() {
  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { message: "Select a store before accessing sales data" },
        { status: 400 },
      ),
    };
  }

  return { activeStoreKey: storeContext.activeStoreKey };
}

function getSettingsValidationMessage(
  paymentMethod: string,
  productType: string,
  settings: Awaited<ReturnType<typeof loadStoreSettingsForStore>>,
) {
  const enabledPaymentMethodIds = new Set(
    settings.paymentMethods
      .filter((method) => method.enabled)
      .map((method) => method.id),
  );
  const enabledProductTypeIds = new Set(
    settings.productTypes.filter((type) => type.enabled).map((type) => type.id),
  );

  if (productType === PAYMENT_ENTRY_SENTINEL) {
    if (!enabledPaymentMethodIds.has(paymentMethod)) {
      return "This payment method is not enabled in store settings";
    }

    return null;
  }

  if (!enabledProductTypeIds.has(productType)) {
    return "This sales detail type is not enabled in store settings";
  }

  return null;
}

async function getSalesReconciliationForDate(
  supabase: SupabaseClient,
  storeKey: string,
  businessDate: string,
) {
  const { data, error } = await supabase
    .from("daily_sales_reconciliations")
    .select(RECONCILIATION_SELECT)
    .eq("store_key", storeKey)
    .eq("reconciliation_date", businessDate)
    .maybeSingle<DailySalesReconciliationRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function ensureSalesSummary(
  supabase: SupabaseClient,
  storeKey: string,
  businessDate: string,
  userId: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("daily_sales_summaries")
    .select(SUMMARY_SELECT)
    .eq("store_key", storeKey)
    .eq("business_date", businessDate)
    .maybeSingle<DailySalesSummaryRow>();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("daily_sales_summaries")
    .insert({
      store_key: storeKey,
      business_date: businessDate,
      created_by: userId,
      updated_by: userId,
    })
    .select(SUMMARY_SELECT)
    .single<DailySalesSummaryRow>();

  if (error || !data) {
    throw error ?? new Error("Failed to create sales summary");
  }

  return data;
}

async function fetchSalesLinesForDate(
  supabase: SupabaseClient,
  storeKey: string,
  businessDate: string,
) {
  const [
    { data: paymentLines, error: paymentError },
    { data: productLines, error: productError },
  ] = await Promise.all([
    supabase
      .from("daily_sales_payment_lines")
      .select(PAYMENT_LINE_SELECT)
      .eq("store_key", storeKey)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false })
      .returns<DailySalesPaymentLineRow[]>(),
    supabase
      .from("daily_sales_product_lines")
      .select(PRODUCT_LINE_SELECT)
      .eq("store_key", storeKey)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false })
      .returns<DailySalesProductLineRow[]>(),
  ]);

  if (paymentError) {
    throw paymentError;
  }

  if (productError) {
    throw productError;
  }

  return {
    paymentLines: paymentLines ?? [],
    productLines: productLines ?? [],
  };
}

function buildSalesDayTotals(
  paymentLines: DailySalesPaymentLineRow[],
  productLines: DailySalesProductLineRow[],
  settings: Awaited<ReturnType<typeof loadStoreSettingsForStore>>,
): SalesDayTotals {
  const paymentBreakdown = buildBreakdown(
    paymentLines,
    (line) => line.payment_method,
    (line) => toNumber(line.amount),
  );
  const productBreakdown = buildBreakdown(
    productLines,
    (line) => line.product_type,
    (line) => toNumber(line.amount),
  );
  const paymentTotal = Object.values(paymentBreakdown).reduce(
    (sum, value) => sum + value,
    0,
  );
  const productTotal = Object.values(productBreakdown).reduce(
    (sum, value) => sum + value,
    0,
  );
  const cashMethodIds = new Set(
    settings.paymentMethods
      .filter((method) => method.countsTowardCash)
      .map((method) => method.id),
  );
  const cashSales = Object.entries(paymentBreakdown).reduce(
    (sum, [methodId, amount]) =>
      cashMethodIds.has(methodId) ? sum + amount : sum,
    0,
  );

  return {
    grossSales: Math.abs(paymentTotal) > 0.009 ? paymentTotal : productTotal,
    paymentTotal,
    productTotal,
    cashSales,
    cashlessSales: paymentTotal - cashSales,
    lineCount: paymentLines.length + productLines.length,
    paymentBreakdown,
    productBreakdown,
  };
}

async function recalculateSalesSummaryForDate(
  supabase: SupabaseClient,
  {
    storeKey,
    businessDate,
    userId,
    settings,
    reconciled,
    reconciledBy,
    reconciledAt,
  }: {
    storeKey: string;
    businessDate: string;
    userId: string;
    settings: Awaited<ReturnType<typeof loadStoreSettingsForStore>>;
    reconciled?: boolean;
    reconciledBy?: string | null;
    reconciledAt?: string | null;
  },
) {
  const { paymentLines, productLines } = await fetchSalesLinesForDate(
    supabase,
    storeKey,
    businessDate,
  );
  const totals = buildSalesDayTotals(paymentLines, productLines, settings);

  if (totals.lineCount === 0 && !reconciled) {
    const { error } = await supabase
      .from("daily_sales_summaries")
      .delete()
      .eq("store_key", storeKey)
      .eq("business_date", businessDate);

    if (error) {
      throw error;
    }

    return null;
  }

  const summary = await ensureSalesSummary(
    supabase,
    storeKey,
    businessDate,
    userId,
  );
  const { data, error } = await supabase
    .from("daily_sales_summaries")
    .update({
      gross_sales: totals.grossSales,
      payment_total: totals.paymentTotal,
      product_total: totals.productTotal,
      cash_sales: totals.cashSales,
      cashless_sales: totals.cashlessSales,
      line_count: totals.lineCount,
      payment_breakdown: totals.paymentBreakdown,
      product_breakdown: totals.productBreakdown,
      reconciled: reconciled ?? false,
      reconciled_by: reconciledBy ?? null,
      reconciled_at: reconciledAt ?? null,
      updated_by: userId,
    })
    .eq("id", summary.id)
    .select(SUMMARY_SELECT)
    .single<DailySalesSummaryRow>();

  if (error || !data) {
    throw error ?? new Error("Failed to update sales summary");
  }

  return {
    summary: data,
    paymentLines,
    productLines,
    totals,
  };
}

async function updateSalesLineReconciliationState(
  supabase: SupabaseClient,
  storeKey: string,
  businessDate: string,
  userId: string,
  reconciledAt: string,
) {
  const [paymentResult, productResult] = await Promise.all([
    supabase
      .from("daily_sales_payment_lines")
      .update({
        reconciled: true,
        reconciled_by: userId,
        reconciled_at: reconciledAt,
      })
      .eq("store_key", storeKey)
      .eq("business_date", businessDate),
    supabase
      .from("daily_sales_product_lines")
      .update({
        reconciled: true,
        reconciled_by: userId,
        reconciled_at: reconciledAt,
      })
      .eq("store_key", storeKey)
      .eq("business_date", businessDate),
  ]);

  if (paymentResult.error) {
    throw paymentResult.error;
  }

  if (productResult.error) {
    throw productResult.error;
  }
}

async function findTransactionLineById(
  supabase: SupabaseClient,
  storeKey: string,
  transactionId: string,
): Promise<NormalizedSalesLine | null> {
  const parsed = parseTransactionId(transactionId);

  const lookupPaymentLine = async (lineId: string) => {
    const { data, error } = await supabase
      .from("daily_sales_payment_lines")
      .select(PAYMENT_LINE_SELECT)
      .eq("id", lineId)
      .eq("store_key", storeKey)
      .maybeSingle<DailySalesPaymentLineRow>();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      lineType: "payment" as const,
      lineId: data.id,
      summaryId: data.sales_summary_id,
      storeKey: data.store_key,
      businessDate: data.business_date,
      amount: toNumber(data.amount),
      description: data.description,
      employeeId: data.employee_id,
      reconciled: data.reconciled,
      reconciledBy: data.reconciled_by,
      reconciledAt: data.reconciled_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      paymentMethod: data.payment_method,
      productType: PAYMENT_ENTRY_SENTINEL,
    };
  };

  const lookupProductLine = async (lineId: string) => {
    const { data, error } = await supabase
      .from("daily_sales_product_lines")
      .select(PRODUCT_LINE_SELECT)
      .eq("id", lineId)
      .eq("store_key", storeKey)
      .maybeSingle<DailySalesProductLineRow>();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      lineType: "product" as const,
      lineId: data.id,
      summaryId: data.sales_summary_id,
      storeKey: data.store_key,
      businessDate: data.business_date,
      amount: toNumber(data.amount),
      description: data.description,
      employeeId: data.employee_id,
      reconciled: data.reconciled,
      reconciledBy: data.reconciled_by,
      reconciledAt: data.reconciled_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      productType: data.product_type,
    };
  };

  if (parsed?.lineType === "payment") {
    return lookupPaymentLine(parsed.lineId);
  }

  if (parsed?.lineType === "product") {
    return lookupProductLine(parsed.lineId);
  }

  return (
    (await lookupPaymentLine(transactionId)) ??
    (await lookupProductLine(transactionId))
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const body = await request.json();

    if (!body.amount || !body.paymentMethod || !body.date) {
      return NextResponse.json(
        { message: "Missing required fields: amount, paymentMethod, date" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await getCurrentUserAccess(supabase, user.id);
    if (!currentUser.canAccessSales) {
      return NextResponse.json(
        { message: "Forbidden: sales access denied" },
        { status: 403 },
      );
    }

    const canAccessHistoricalDates = canManageHistoricalSalesLogs(
      currentUser.role,
    );
    const isoDate = toIsoDate(body.date);
    const storeResult = await getActiveStoreKey();

    if ("error" in storeResult) {
      return storeResult.error;
    }

    if (!isoDate) {
      return NextResponse.json(
        { message: "Invalid date supplied" },
        { status: 400 },
      );
    }

    const { activeStoreKey } = storeResult;
    const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
    const todayIsoDate = getTodayIsoDateInTimeZone(settings.profile.timezone);
    const validationMessage = getSettingsValidationMessage(
      String(body.paymentMethod),
      String(body.productType || "other"),
      settings,
    );

    if (validationMessage) {
      return NextResponse.json({ message: validationMessage }, { status: 400 });
    }

    if (!canAccessHistoricalDates && isoDate !== todayIsoDate) {
      return NextResponse.json(
        {
          message:
            "Only today's sales logs can be created for non-admin accounts",
        },
        { status: 403 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      supabase,
      activeStoreKey,
      isoDate,
      `Sales log ${isoDate}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      );
    }

    const reconciliation = await getSalesReconciliationForDate(
      supabase,
      activeStoreKey,
      isoDate,
    );

    if (reconciliation) {
      return NextResponse.json(
        { message: "Cannot add entries to a closed-out day" },
        { status: 409 },
      );
    }

    const summary = await ensureSalesSummary(
      supabase,
      activeStoreKey,
      isoDate,
      user.id,
    );
    const isPaymentEntry = String(body.productType) === PAYMENT_ENTRY_SENTINEL;

    if (isPaymentEntry) {
      const { data, error } = await supabase
        .from("daily_sales_payment_lines")
        .insert({
          sales_summary_id: summary.id,
          store_key: activeStoreKey,
          business_date: isoDate,
          amount: Number(body.amount),
          payment_method: body.paymentMethod,
          description: body.description || null,
          employee_id: user.id,
          reconciled: false,
        })
        .select(PAYMENT_LINE_SELECT)
        .single<DailySalesPaymentLineRow>();

      if (error || !data) {
        return NextResponse.json(
          { message: error?.message ?? "Failed to create transaction" },
          { status: 500 },
        );
      }

      await recalculateSalesSummaryForDate(supabase, {
        storeKey: activeStoreKey,
        businessDate: isoDate,
        userId: user.id,
        settings,
      });

      await appendAuditEvent({
        supabase,
        storeKey: activeStoreKey,
        entityType: "daily_sales_payment_line",
        entityId: data.id,
        action: "sales.logged",
        summary: `Sales payment logged for ${data.business_date}`,
        actorId: user.id,
        actorName: currentUser.fullName ?? user.email ?? "User",
        actorRole: currentUser.role ?? "employee",
        metadata: {
          businessDate: data.business_date,
          amount: toNumber(data.amount),
          paymentMethod: data.payment_method,
          description: data.description,
        },
      });

      return NextResponse.json(mapPaymentLineRow(data), { status: 201 });
    }

    const { data, error } = await supabase
      .from("daily_sales_product_lines")
      .insert({
        sales_summary_id: summary.id,
        store_key: activeStoreKey,
        business_date: isoDate,
        amount: Number(body.amount),
        product_type: body.productType || "other",
        description: body.description || null,
        employee_id: user.id,
        reconciled: false,
      })
      .select(PRODUCT_LINE_SELECT)
      .single<DailySalesProductLineRow>();

    if (error || !data) {
      return NextResponse.json(
        { message: error?.message ?? "Failed to create transaction" },
        { status: 500 },
      );
    }

    await recalculateSalesSummaryForDate(supabase, {
      storeKey: activeStoreKey,
      businessDate: isoDate,
      userId: user.id,
      settings,
    });

    await appendAuditEvent({
      supabase,
      storeKey: activeStoreKey,
      entityType: "daily_sales_product_line",
      entityId: data.id,
      action: "sales.logged",
      summary: `Sales detail logged for ${data.business_date}`,
      actorId: user.id,
      actorName: currentUser.fullName ?? user.email ?? "User",
      actorRole: currentUser.role ?? "employee",
      metadata: {
        businessDate: data.business_date,
        amount: toNumber(data.amount),
        productType: data.product_type,
        description: data.description,
      },
    });

    return NextResponse.json(mapProductLineRow(data), { status: 201 });
  } catch (error) {
    console.error("Sales POST error:", error);
    return NextResponse.json(
      { message: "Failed to create transaction" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get("date");
    const paymentMethod = searchParams.get("paymentMethod");
    const includeReconciliations =
      searchParams.get("includeReconciliations") === "true";

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await getCurrentUserAccess(supabase, user.id);
    if (!currentUser.canAccessSales) {
      return NextResponse.json(
        { message: "Forbidden: sales access denied" },
        { status: 403 },
      );
    }

    const canAccessHistoricalDates = canManageHistoricalSalesLogs(
      currentUser.role,
    );
    const storeResult = await getActiveStoreKey();

    if ("error" in storeResult) {
      return storeResult.error;
    }

    const { activeStoreKey } = storeResult;
    const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
    const todayIsoDate = getTodayIsoDateInTimeZone(settings.profile.timezone);
    const requestedDate = toIsoDate(date);

    if (
      requestedDate &&
      !canAccessHistoricalDates &&
      requestedDate !== todayIsoDate
    ) {
      return NextResponse.json(
        {
          message:
            "Only today's sales logs can be viewed for non-admin accounts",
        },
        { status: 403 },
      );
    }

    let paymentLinesQuery = supabase
      .from("daily_sales_payment_lines")
      .select(PAYMENT_LINE_SELECT)
      .eq("store_key", activeStoreKey)
      .order("created_at", { ascending: false });
    let productLinesQuery = paymentMethod
      ? null
      : supabase
          .from("daily_sales_product_lines")
          .select(PRODUCT_LINE_SELECT)
          .eq("store_key", activeStoreKey)
          .order("created_at", { ascending: false });
    let summariesQuery = supabase
      .from("daily_sales_summaries")
      .select(SUMMARY_SELECT)
      .eq("store_key", activeStoreKey)
      .order("business_date", { ascending: false });

    if (requestedDate) {
      paymentLinesQuery = paymentLinesQuery.eq("business_date", requestedDate);
      if (productLinesQuery) {
        productLinesQuery = productLinesQuery.eq(
          "business_date",
          requestedDate,
        );
      }
      summariesQuery = summariesQuery.eq("business_date", requestedDate);
    } else if (!canAccessHistoricalDates) {
      paymentLinesQuery = paymentLinesQuery.eq("business_date", todayIsoDate);
      if (productLinesQuery) {
        productLinesQuery = productLinesQuery.eq("business_date", todayIsoDate);
      }
      summariesQuery = summariesQuery.eq("business_date", todayIsoDate);
    }

    if (paymentMethod) {
      paymentLinesQuery = paymentLinesQuery.eq("payment_method", paymentMethod);
    }

    const [
      { data: paymentLines, error: paymentError },
      { data: productLines, error: productError },
      { data: summaryRows, error: summaryError },
    ] = await Promise.all([
      paymentLinesQuery.returns<DailySalesPaymentLineRow[]>(),
      productLinesQuery
        ? productLinesQuery.returns<DailySalesProductLineRow[]>()
        : Promise.resolve({
            data: [] as DailySalesProductLineRow[],
            error: null as { message?: string | null } | null,
          }),
      summariesQuery.returns<DailySalesSummaryRow[]>(),
    ]);

    if (paymentError) {
      return NextResponse.json(
        { message: paymentError.message ?? "Failed to fetch payment lines" },
        { status: 500 },
      );
    }

    if (productError) {
      return NextResponse.json(
        { message: productError.message ?? "Failed to fetch sales details" },
        { status: 500 },
      );
    }

    if (summaryError) {
      return NextResponse.json(
        { message: summaryError.message ?? "Failed to fetch sales summaries" },
        { status: 500 },
      );
    }

    let reconciliations: DailyReconciliation[] | undefined;

    if (includeReconciliations) {
      let reconciliationQuery = supabase
        .from("daily_sales_reconciliations")
        .select(RECONCILIATION_SELECT)
        .eq("store_key", activeStoreKey)
        .order("reconciliation_date", { ascending: false });

      if (requestedDate) {
        reconciliationQuery = reconciliationQuery.eq(
          "reconciliation_date",
          requestedDate,
        );
      } else if (!canAccessHistoricalDates) {
        reconciliationQuery = reconciliationQuery.eq(
          "reconciliation_date",
          todayIsoDate,
        );
      }

      const { data: reconciliationRows, error: reconciliationError } =
        await reconciliationQuery.returns<DailySalesReconciliationRow[]>();

      if (reconciliationError) {
        return NextResponse.json(
          {
            message:
              reconciliationError.message ?? "Failed to fetch reconciliations",
          },
          { status: 500 },
        );
      }

      reconciliations = (reconciliationRows ?? []).map(mapReconciliationRow);
    }

    const transactions = [
      ...(paymentLines ?? []).map(mapPaymentLineRow),
      ...(productLines ?? []).map(mapProductLineRow),
    ].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    const summaries = (summaryRows ?? []).map(mapSummaryRow);
    const isClosedOut = requestedDate
      ? (summaries[0]?.reconciled ?? false)
      : false;

    return NextResponse.json({
      transactions,
      summaries,
      isClosedOut,
      reconciliations,
    });
  } catch (error) {
    console.error("Sales GET error:", error);
    return NextResponse.json(
      { message: "Failed to fetch transactions" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const body = await request.json();
    const { reconciliationData } = body;

    if (!reconciliationData) {
      return NextResponse.json(
        { message: "Missing reconciliationData" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await getCurrentUserAccess(supabase, user.id);
    if (!currentUser.canAccessSales) {
      return NextResponse.json(
        { message: "Forbidden: sales access denied" },
        { status: 403 },
      );
    }

    const canAccessHistoricalDates = canManageHistoricalSalesLogs(
      currentUser.role,
    );
    const isoDate = toIsoDate(reconciliationData.date);
    const storeResult = await getActiveStoreKey();

    if ("error" in storeResult) {
      return storeResult.error;
    }

    if (!isoDate) {
      return NextResponse.json(
        { message: "Invalid date supplied" },
        { status: 400 },
      );
    }

    const { activeStoreKey } = storeResult;
    const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
    const todayIsoDate = getTodayIsoDateInTimeZone(settings.profile.timezone);

    if (!canAccessHistoricalDates && isoDate !== todayIsoDate) {
      return NextResponse.json(
        {
          message:
            "Only today's sales logs can be reconciled for non-admin accounts",
        },
        { status: 403 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      supabase,
      activeStoreKey,
      isoDate,
      `Sales reconciliation ${isoDate}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      );
    }

    const { paymentLines, productLines } = await fetchSalesLinesForDate(
      supabase,
      activeStoreKey,
      isoDate,
    );
    const totals = buildSalesDayTotals(paymentLines, productLines, settings);

    if (totals.paymentTotal === 0 || totals.productTotal === 0) {
      return NextResponse.json(
        {
          message:
            "Payment totals and sales details must be logged before closeout",
        },
        { status: 400 },
      );
    }

    if (!totalsMatch(totals.paymentTotal, totals.productTotal)) {
      return NextResponse.json(
        {
          message:
            "Payment totals and sales details must match before closeout",
        },
        { status: 400 },
      );
    }

    const reconciledAt = new Date().toISOString();
    const expectedCash =
      Number(reconciliationData.openingFloat || 0) +
      totals.cashSales -
      Number(reconciliationData.totalPayouts || 0);
    const actualCash = Number(reconciliationData.cashCounted || 0);

    const summaryState = await recalculateSalesSummaryForDate(supabase, {
      storeKey: activeStoreKey,
      businessDate: isoDate,
      userId: user.id,
      settings,
      reconciled: true,
      reconciledBy: user.id,
      reconciledAt,
    });

    if (!summaryState) {
      return NextResponse.json(
        { message: "No sales logs are available for reconciliation" },
        { status: 400 },
      );
    }

    const reconciliationPayload = {
      store_key: activeStoreKey,
      reconciliation_date: isoDate,
      opening_float: Number(reconciliationData.openingFloat || 0),
      closing_float: Number(reconciliationData.closingFloat || 0),
      cash_counted: actualCash,
      total_payouts: Number(reconciliationData.totalPayouts || 0),
      total_cash_sales: totals.cashSales,
      total_card_sales: totals.cashlessSales,
      total_expected: expectedCash,
      total_actual: actualCash,
      variance: expectedCash - actualCash,
      variance_percent:
        ((expectedCash - actualCash) / (expectedCash || 1)) * 100,
      product_breakdown: totals.productBreakdown,
      reconciled_by: user.id,
      reconciled_at: reconciledAt,
      notes: reconciliationData.notes || null,
      status: "approved" as const,
    };

    const { data, error } = await supabase
      .from("daily_sales_reconciliations")
      .upsert(reconciliationPayload, {
        onConflict: "store_key,reconciliation_date",
      })
      .select(RECONCILIATION_SELECT)
      .single<DailySalesReconciliationRow>();

    if (error || !data) {
      return NextResponse.json(
        { message: error?.message ?? "Failed to reconcile sales" },
        { status: 500 },
      );
    }

    await updateSalesLineReconciliationState(
      supabase,
      activeStoreKey,
      isoDate,
      user.id,
      reconciledAt,
    );

    await appendAuditEvent({
      supabase,
      storeKey: activeStoreKey,
      entityType: "daily_sales_reconciliation",
      entityId: data.id,
      action: "sales.reconciled",
      summary: `Sales reconciled for ${data.reconciliation_date}`,
      actorId: user.id,
      actorName: currentUser.fullName ?? user.email ?? "User",
      actorRole: currentUser.role ?? "employee",
      metadata: {
        reconciliationDate: data.reconciliation_date,
        grossSales: summaryState.totals.grossSales,
        paymentTotal: summaryState.totals.paymentTotal,
        productTotal: summaryState.totals.productTotal,
        totalExpected: toNumber(data.total_expected),
        totalActual: toNumber(data.total_actual),
        variance: toNumber(data.variance),
        variancePercent: toNumber(data.variance_percent),
        status: data.status,
      },
    });

    return NextResponse.json(mapReconciliationRow(data), { status: 201 });
  } catch (error) {
    console.error("Sales PATCH error:", error);
    return NextResponse.json(
      { message: "Failed to reconcile sales" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const transactionId = request.nextUrl.searchParams.get("id");

    if (!transactionId) {
      return NextResponse.json(
        { message: "Missing required field: id" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await getCurrentUserAccess(supabase, user.id);
    if (!currentUser.canAccessSales) {
      return NextResponse.json(
        { message: "Forbidden: sales access denied" },
        { status: 403 },
      );
    }

    const canAccessHistoricalDates = canManageHistoricalSalesLogs(
      currentUser.role,
    );
    const storeResult = await getActiveStoreKey();

    if ("error" in storeResult) {
      return storeResult.error;
    }

    const { activeStoreKey } = storeResult;
    const entry = await findTransactionLineById(
      supabase,
      activeStoreKey,
      transactionId,
    );

    if (!entry) {
      return NextResponse.json({ message: "Entry not found" }, { status: 404 });
    }

    if (entry.reconciled) {
      return NextResponse.json(
        {
          message:
            "Reconciled sales entries cannot be reversed. Record a new offsetting log on the correct business day instead.",
        },
        { status: 409 },
      );
    }

    const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
    const todayIsoDate = getTodayIsoDateInTimeZone(settings.profile.timezone);

    if (!canAccessHistoricalDates && entry.businessDate !== todayIsoDate) {
      return NextResponse.json(
        {
          message:
            "Only today's sales logs can be reversed for non-admin accounts",
        },
        { status: 403 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      supabase,
      activeStoreKey,
      entry.businessDate,
      `Sales log ${entry.businessDate}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      );
    }

    if (isReversalDescription(entry.description)) {
      return NextResponse.json(
        { message: "Reversal entries cannot be reversed again" },
        { status: 409 },
      );
    }

    const reversalDescription = buildSalesReversalDescription({
      id: transactionId,
      description: entry.description ?? undefined,
    });
    const reversalAmount = entry.amount * -1;

    if (entry.lineType === "payment") {
      const { data: existingReversal, error: lookupError } = await supabase
        .from("daily_sales_payment_lines")
        .select("id")
        .eq("store_key", activeStoreKey)
        .eq("business_date", entry.businessDate)
        .eq("payment_method", entry.paymentMethod)
        .eq("description", reversalDescription)
        .eq("amount", reversalAmount)
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (lookupError) {
        return NextResponse.json(
          {
            message:
              lookupError.message ??
              "Failed to inspect existing reversal entries",
          },
          { status: 500 },
        );
      }

      if (existingReversal) {
        return NextResponse.json({
          message: "Entry was already reversed",
          reversalId: createTransactionId("payment", existingReversal.id),
        });
      }

      const { data, error } = await supabase
        .from("daily_sales_payment_lines")
        .insert({
          sales_summary_id: entry.summaryId,
          store_key: activeStoreKey,
          business_date: entry.businessDate,
          amount: reversalAmount,
          payment_method: entry.paymentMethod,
          description: reversalDescription,
          employee_id: user.id,
          reconciled: false,
        })
        .select(PAYMENT_LINE_SELECT)
        .single<DailySalesPaymentLineRow>();

      if (error || !data) {
        return NextResponse.json(
          { message: error?.message ?? "Failed to reverse transaction" },
          { status: 500 },
        );
      }

      await recalculateSalesSummaryForDate(supabase, {
        storeKey: activeStoreKey,
        businessDate: entry.businessDate,
        userId: user.id,
        settings,
      });

      await appendAuditEvent({
        supabase,
        storeKey: activeStoreKey,
        entityType: "daily_sales_payment_line",
        entityId: entry.lineId,
        action: "sales.reversed",
        summary: `Sales payment reversed for ${entry.businessDate}`,
        actorId: user.id,
        actorName: currentUser.fullName ?? user.email ?? "User",
        actorRole: currentUser.role ?? "employee",
        metadata: {
          originalEntryId: transactionId,
          reversalEntryId: createTransactionId("payment", data.id),
          businessDate: entry.businessDate,
          amount: entry.amount,
          reversalAmount,
          paymentMethod: entry.paymentMethod,
        },
      });

      return NextResponse.json({
        message: "Transaction reversed with an offsetting entry",
        reversalId: createTransactionId("payment", data.id),
      });
    }

    const { data: existingReversal, error: lookupError } = await supabase
      .from("daily_sales_product_lines")
      .select("id")
      .eq("store_key", activeStoreKey)
      .eq("business_date", entry.businessDate)
      .eq("product_type", entry.productType)
      .eq("description", reversalDescription)
      .eq("amount", reversalAmount)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (lookupError) {
      return NextResponse.json(
        {
          message:
            lookupError.message ??
            "Failed to inspect existing reversal entries",
        },
        { status: 500 },
      );
    }

    if (existingReversal) {
      return NextResponse.json({
        message: "Entry was already reversed",
        reversalId: createTransactionId("product", existingReversal.id),
      });
    }

    const { data, error } = await supabase
      .from("daily_sales_product_lines")
      .insert({
        sales_summary_id: entry.summaryId,
        store_key: activeStoreKey,
        business_date: entry.businessDate,
        amount: reversalAmount,
        product_type: entry.productType,
        description: reversalDescription,
        employee_id: user.id,
        reconciled: false,
      })
      .select(PRODUCT_LINE_SELECT)
      .single<DailySalesProductLineRow>();

    if (error || !data) {
      return NextResponse.json(
        { message: error?.message ?? "Failed to reverse transaction" },
        { status: 500 },
      );
    }

    await recalculateSalesSummaryForDate(supabase, {
      storeKey: activeStoreKey,
      businessDate: entry.businessDate,
      userId: user.id,
      settings,
    });

    await appendAuditEvent({
      supabase,
      storeKey: activeStoreKey,
      entityType: "daily_sales_product_line",
      entityId: entry.lineId,
      action: "sales.reversed",
      summary: `Sales detail reversed for ${entry.businessDate}`,
      actorId: user.id,
      actorName: currentUser.fullName ?? user.email ?? "User",
      actorRole: currentUser.role ?? "employee",
      metadata: {
        originalEntryId: transactionId,
        reversalEntryId: createTransactionId("product", data.id),
        businessDate: entry.businessDate,
        amount: entry.amount,
        reversalAmount,
        productType: entry.productType,
      },
    });

    return NextResponse.json({
      message: "Transaction reversed with an offsetting entry",
      reversalId: createTransactionId("product", data.id),
    });
  } catch (error) {
    console.error("Sales DELETE error:", error);
    return NextResponse.json(
      { message: "Failed to reverse transaction" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const body = await request.json();
    const { id, amount, paymentMethod, productType, description, date } = body;

    if (!id) {
      return NextResponse.json(
        { message: "Missing required field: id" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await getCurrentUserAccess(supabase, user.id);
    if (!currentUser.canAccessSales) {
      return NextResponse.json(
        { message: "Forbidden: sales access denied" },
        { status: 403 },
      );
    }

    const canAccessHistoricalDates = canManageHistoricalSalesLogs(
      currentUser.role,
    );
    const storeResult = await getActiveStoreKey();

    if ("error" in storeResult) {
      return storeResult.error;
    }

    const { activeStoreKey } = storeResult;
    const entry = await findTransactionLineById(supabase, activeStoreKey, id);

    if (!entry) {
      return NextResponse.json({ message: "Entry not found" }, { status: 404 });
    }

    if (entry.reconciled) {
      return NextResponse.json(
        { message: "Cannot edit reconciled entries" },
        { status: 409 },
      );
    }

    const requestedIsoDate = date ? toIsoDate(date) : entry.businessDate;

    if (!requestedIsoDate) {
      return NextResponse.json(
        { message: "Invalid date supplied" },
        { status: 400 },
      );
    }

    const settings = await loadStoreSettingsForStore(supabase, activeStoreKey);
    const todayIsoDate = getTodayIsoDateInTimeZone(settings.profile.timezone);

    if (
      !canAccessHistoricalDates &&
      (entry.businessDate !== todayIsoDate || requestedIsoDate !== todayIsoDate)
    ) {
      return NextResponse.json(
        {
          message:
            "Only today's sales logs can be edited for non-admin accounts",
        },
        { status: 403 },
      );
    }

    const currentPeriodLock = await assertAccountingPeriodUnlocked(
      supabase,
      activeStoreKey,
      entry.businessDate,
      `Sales log ${entry.businessDate}`,
    );

    if (currentPeriodLock) {
      return NextResponse.json(
        { message: currentPeriodLock.error },
        { status: currentPeriodLock.status },
      );
    }

    if (requestedIsoDate !== entry.businessDate) {
      const targetPeriodLock = await assertAccountingPeriodUnlocked(
        supabase,
        activeStoreKey,
        requestedIsoDate,
        `Sales log ${requestedIsoDate}`,
      );

      if (targetPeriodLock) {
        return NextResponse.json(
          { message: targetPeriodLock.error },
          { status: targetPeriodLock.status },
        );
      }
    }

    const currentDayReconciliation = await getSalesReconciliationForDate(
      supabase,
      activeStoreKey,
      entry.businessDate,
    );

    if (currentDayReconciliation) {
      return NextResponse.json(
        { message: "Cannot edit entries from a closed-out day" },
        { status: 409 },
      );
    }

    if (requestedIsoDate !== entry.businessDate) {
      const targetDayReconciliation = await getSalesReconciliationForDate(
        supabase,
        activeStoreKey,
        requestedIsoDate,
      );

      if (targetDayReconciliation) {
        return NextResponse.json(
          { message: "Cannot move entries into a closed-out day" },
          { status: 409 },
        );
      }
    }

    const nextPaymentMethod =
      entry.lineType === "payment"
        ? typeof paymentMethod === "string"
          ? paymentMethod
          : entry.paymentMethod
        : "other";
    const nextProductType =
      entry.lineType === "payment"
        ? PAYMENT_ENTRY_SENTINEL
        : typeof productType === "string"
          ? productType
          : entry.productType;
    const validationMessage = getSettingsValidationMessage(
      String(nextPaymentMethod),
      String(nextProductType),
      settings,
    );

    if (validationMessage) {
      return NextResponse.json({ message: validationMessage }, { status: 400 });
    }

    const nextSummary = await ensureSalesSummary(
      supabase,
      activeStoreKey,
      requestedIsoDate,
      user.id,
    );

    if (entry.lineType === "payment") {
      const updatePayload = {
        sales_summary_id: nextSummary.id,
        store_key: activeStoreKey,
        business_date: requestedIsoDate,
        amount: amount !== undefined ? Number(amount) : entry.amount,
        payment_method: nextPaymentMethod,
        description:
          description !== undefined ? description : entry.description,
      };
      const { data, error } = await supabase
        .from("daily_sales_payment_lines")
        .update(updatePayload)
        .eq("id", entry.lineId)
        .eq("store_key", activeStoreKey)
        .select(PAYMENT_LINE_SELECT)
        .single<DailySalesPaymentLineRow>();

      if (error || !data) {
        return NextResponse.json(
          { message: error?.message ?? "Failed to update transaction" },
          { status: 500 },
        );
      }

      await recalculateSalesSummaryForDate(supabase, {
        storeKey: activeStoreKey,
        businessDate: entry.businessDate,
        userId: user.id,
        settings,
      });

      if (requestedIsoDate !== entry.businessDate) {
        await recalculateSalesSummaryForDate(supabase, {
          storeKey: activeStoreKey,
          businessDate: requestedIsoDate,
          userId: user.id,
          settings,
        });
      }

      await appendAuditEvent({
        supabase,
        storeKey: activeStoreKey,
        entityType: "daily_sales_payment_line",
        entityId: data.id,
        action: "sales.updated",
        summary: `Sales payment updated for ${data.business_date}`,
        actorId: user.id,
        actorName: currentUser.fullName ?? user.email ?? "User",
        actorRole: currentUser.role ?? "employee",
        metadata: {
          previousBusinessDate: entry.businessDate,
          nextBusinessDate: data.business_date,
          previousAmount: entry.amount,
          nextAmount: toNumber(data.amount),
          previousPaymentMethod: entry.paymentMethod,
          nextPaymentMethod: data.payment_method,
          previousDescription: entry.description,
          nextDescription: data.description,
        },
      });

      return NextResponse.json(mapPaymentLineRow(data));
    }

    const updatePayload = {
      sales_summary_id: nextSummary.id,
      store_key: activeStoreKey,
      business_date: requestedIsoDate,
      amount: amount !== undefined ? Number(amount) : entry.amount,
      product_type: nextProductType,
      description: description !== undefined ? description : entry.description,
    };
    const { data, error } = await supabase
      .from("daily_sales_product_lines")
      .update(updatePayload)
      .eq("id", entry.lineId)
      .eq("store_key", activeStoreKey)
      .select(PRODUCT_LINE_SELECT)
      .single<DailySalesProductLineRow>();

    if (error || !data) {
      return NextResponse.json(
        { message: error?.message ?? "Failed to update transaction" },
        { status: 500 },
      );
    }

    await recalculateSalesSummaryForDate(supabase, {
      storeKey: activeStoreKey,
      businessDate: entry.businessDate,
      userId: user.id,
      settings,
    });

    if (requestedIsoDate !== entry.businessDate) {
      await recalculateSalesSummaryForDate(supabase, {
        storeKey: activeStoreKey,
        businessDate: requestedIsoDate,
        userId: user.id,
        settings,
      });
    }

    await appendAuditEvent({
      supabase,
      storeKey: activeStoreKey,
      entityType: "daily_sales_product_line",
      entityId: data.id,
      action: "sales.updated",
      summary: `Sales detail updated for ${data.business_date}`,
      actorId: user.id,
      actorName: currentUser.fullName ?? user.email ?? "User",
      actorRole: currentUser.role ?? "employee",
      metadata: {
        previousBusinessDate: entry.businessDate,
        nextBusinessDate: data.business_date,
        previousAmount: entry.amount,
        nextAmount: toNumber(data.amount),
        previousProductType: entry.productType,
        nextProductType: data.product_type,
        previousDescription: entry.description,
        nextDescription: data.description,
      },
    });

    return NextResponse.json(mapProductLineRow(data));
  } catch (error) {
    console.error("Sales PUT error:", error);
    return NextResponse.json(
      { message: "Failed to update transaction" },
      { status: 500 },
    );
  }
}
