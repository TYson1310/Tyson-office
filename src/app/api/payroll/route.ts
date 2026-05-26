import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { collapseUserRole } from "@/lib/auth/shared";
import {
  DEFAULT_PAYROLL_PAYMENT_METHOD,
  isPayrollPaymentMethod,
} from "@/lib/payroll/payment-methods";
import { canManagePayrollAdjustments } from "@/lib/payroll/permissions";
import type {
  Paystub,
  PayrollDeductions,
  PayrollPaymentMethod,
  UserRole,
} from "@/types/erp.types";
import {
  calculatePayStatementTotals,
  isMissingHourlyPayrollFieldsError,
  PAY_STATEMENT_SELECT_BASE,
  PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS,
  selectPayStatementsWithFallback,
} from "@/lib/payroll/pay-statements";
import {
  formatPayrollDateLabel,
  getLatestAvailablePayrollPeriod,
  getPayrollFrequencyLabel,
  isPayrollFrequency,
  type PayrollFrequency,
} from "@/lib/payroll/payroll-periods";
import { getServerStoreContext } from "@/lib/stores/server";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type PayStatementDeductionRow = {
  id: string;
  label: string;
  amount: number;
  sort_order: number | null;
};

type FinalizedShiftHoursRow = {
  entry_date: string;
  hours_worked: number | string;
};

type PayrollProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole | null;
  status: "active" | "inactive" | "on-leave" | null;
};

type ExistingPayrollTermRow = {
  id: string;
  employee_id: string;
};

type OverlappingPayStatementRow = {
  id: string;
  employee_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  status: "draft" | "scheduled" | "paid" | "archived";
};

type PayStatementRow = {
  id: string;
  employee_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  payment_method?: PayrollPaymentMethod | null;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
  regular_hours?: number | null;
  overtime_hours: number | null;
  hourly_rate?: number | null;
  overtime_multiplier?: number | null;
  bonus_amount: number | null;
  status: "draft" | "scheduled" | "paid" | "archived";
  notes: string | null;
  created_at: string;
  updated_at: string;
  pay_statement_deductions: PayStatementDeductionRow[] | null;
};

type PayrollRunLockStatus = {
  frequency: PayrollFrequency;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  nextAvailableOn: string;
  isLocked: boolean;
  processedCount: number;
  lockReason: string | null;
  isCustomRange: boolean;
  pendingShiftCount: number;
  pendingEmployeeCount: number;
  warningMessage: string | null;
};

type PayrollRunStatusError =
  | "migration_required"
  | {
      message?: string | null;
      code?: string | null;
    };

type PendingShiftRow = {
  employee_id: string;
  entry_date: string;
  clock_out_at: string | null;
  verified_at: string | null;
};

type PendingExceptionRow = {
  employee_id: string;
  exception_date: string;
};

type PendingShiftSummary = {
  pendingShiftCount: number;
  pendingEmployeeCount: number;
  warningMessage: string | null;
};

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
        { message: "Select a store before accessing payroll" },
        { status: 400 },
      ),
    };
  }

  return { activeStoreKey: storeContext.activeStoreKey };
}

function toIsoDate(value?: string | Date | null) {
  if (!value) return null;

  try {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function addUtcDaysToIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildCustomPayrollPeriodLabel(periodStart: string, periodEnd: string) {
  return `Custom payroll (${formatPayrollDateLabel(periodStart)} - ${formatPayrollDateLabel(periodEnd)})`;
}

function isMissingShiftTrackingError(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("shift_time_entries") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("could not find"))
  );
}

function isMissingPayrollFrequencyFieldError(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("pay_statements.pay_frequency") ||
    message.includes("'pay_frequency' column of 'pay_statements'")
  );
}

function isMissingAttendanceExceptionsError(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("attendance_exceptions") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("could not find"))
  );
}

function buildPendingShiftWarningMessage(input: {
  pendingShiftCount: number;
  pendingEmployeeCount: number;
  periodStart: string;
  periodEnd: string;
  employeeId?: string | null;
}) {
  const {
    pendingShiftCount,
    pendingEmployeeCount,
    periodStart,
    periodEnd,
    employeeId,
  } = input;

  if (pendingShiftCount <= 0) {
    return null;
  }

  const employeeScope = employeeId
    ? "for this employee"
    : `across ${pendingEmployeeCount} employee${pendingEmployeeCount === 1 ? "" : "s"}`;

  return `Warning: You have ${pendingShiftCount} pending shift${pendingShiftCount === 1 ? "" : "s"} ${employeeScope} between ${formatPayrollDateLabel(periodStart)} and ${formatPayrollDateLabel(periodEnd)}. Resolve or verify them before running payroll.`;
}

async function getPendingShiftSummary(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  storeKey: string;
  periodStart: string;
  periodEnd: string;
  employeeId?: string | null;
}): Promise<PendingShiftSummary | { error: { message?: string | null } }> {
  const { supabase, storeKey, periodStart, periodEnd, employeeId } = input;
  let shiftQuery = supabase
    .from("shift_time_entries")
    .select("employee_id,entry_date,clock_out_at,verified_at")
    .eq("store_key", storeKey)
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd);
  let exceptionQuery = supabase
    .from("attendance_exceptions")
    .select("employee_id,exception_date")
    .eq("store_key", storeKey)
    .eq("status", "open")
    .gte("exception_date", periodStart)
    .lte("exception_date", periodEnd);

  if (employeeId) {
    shiftQuery = shiftQuery.eq("employee_id", employeeId);
    exceptionQuery = exceptionQuery.eq("employee_id", employeeId);
  }

  const [shiftResult, exceptionResult] = await Promise.all([
    shiftQuery.returns<PendingShiftRow[]>(),
    exceptionQuery.returns<PendingExceptionRow[]>(),
  ]);

  if (shiftResult.error && !isMissingShiftTrackingError(shiftResult.error)) {
    return { error: shiftResult.error };
  }

  if (
    exceptionResult.error &&
    !isMissingAttendanceExceptionsError(exceptionResult.error)
  ) {
    return { error: exceptionResult.error };
  }

  const pendingShiftKeys = new Set<string>();
  const pendingEmployeeIds = new Set<string>();

  (exceptionResult.data ?? []).forEach((row) => {
    pendingShiftKeys.add(`${row.employee_id}:${row.exception_date}`);
    pendingEmployeeIds.add(row.employee_id);
  });

  (shiftResult.data ?? [])
    .filter((row) => !row.clock_out_at || !row.verified_at)
    .forEach((row) => {
      pendingShiftKeys.add(`${row.employee_id}:${row.entry_date}`);
      pendingEmployeeIds.add(row.employee_id);
    });

  const pendingShiftCount = pendingShiftKeys.size;
  const pendingEmployeeCount = pendingEmployeeIds.size;

  return {
    pendingShiftCount,
    pendingEmployeeCount,
    warningMessage: buildPendingShiftWarningMessage({
      pendingShiftCount,
      pendingEmployeeCount,
      periodStart,
      periodEnd,
      employeeId,
    }),
  };
}

function getPayrollRunUnavailableResponse() {
  return NextResponse.json(
    {
      message:
        "Payroll run scheduling fields are not available yet. Apply the latest Supabase payroll migrations first.",
    },
    { status: 503 },
  );
}

function mapStatementStatusToPaystubStatus(
  status: PayStatementRow["status"],
): Paystub["status"] {
  if (status === "archived") {
    return "archived";
  }

  if (status === "paid") {
    return "paid";
  }

  if (status === "draft") {
    return "draft";
  }

  return "processed";
}

function mapPaystubStatusToStatementStatus(
  status: unknown,
): PayStatementRow["status"] {
  if (status === "archived") {
    return "archived";
  }

  if (status === "paid") {
    return "paid";
  }

  if (status === "processed") {
    return "scheduled";
  }

  return "draft";
}

function mapDeductionSummary(
  rows: PayStatementDeductionRow[] | null,
  total: number,
): PayrollDeductions {
  const summary: PayrollDeductions = {
    incomeTax: 0,
    socialSecurity: 0,
    healthInsurance: 0,
    employeeAdvance: 0,
    other: 0,
    total,
  };

  (rows ?? []).forEach((row) => {
    const label = row.label.toLowerCase();
    const amount = Number(row.amount ?? 0);

    if (label.includes("tax")) {
      summary.incomeTax += amount;
      return;
    }

    if (label.includes("social")) {
      summary.socialSecurity += amount;
      return;
    }

    if (label.includes("health") || label.includes("insurance")) {
      summary.healthInsurance += amount;
      return;
    }

    if (label.includes("advance")) {
      summary.employeeAdvance = (summary.employeeAdvance ?? 0) + amount;
      return;
    }

    summary.other = (summary.other ?? 0) + amount;
  });

  return summary;
}

function buildDeductionRows(
  deductions: Partial<PayrollDeductions> | undefined,
) {
  if (!deductions) {
    return [];
  }

  const rows = [
    { label: "Income Tax", amount: deductions.incomeTax ?? 0 },
    { label: "Social Security", amount: deductions.socialSecurity ?? 0 },
    { label: "Health Insurance", amount: deductions.healthInsurance ?? 0 },
    { label: "Employee Advance", amount: deductions.employeeAdvance ?? 0 },
    { label: "Other", amount: deductions.other ?? 0 },
  ];

  return rows
    .filter((row) => Number(row.amount) > 0)
    .map((row, index) => ({
      label: row.label,
      amount: Number(row.amount),
      sort_order: index,
    }));
}

function buildYtdTotals(rows: PayStatementRow[]) {
  const totalsByEmployee = new Map<
    string,
    { gross: number; tax: number; net: number }
  >();
  const totalsByStatement = new Map<
    string,
    { gross: number; tax: number; net: number }
  >();

  [...rows]
    .sort(
      (left, right) =>
        new Date(left.pay_date).getTime() - new Date(right.pay_date).getTime(),
    )
    .forEach((row) => {
      const previous = totalsByEmployee.get(row.employee_id) ?? {
        gross: 0,
        tax: 0,
        net: 0,
      };
      const deductions = mapDeductionSummary(
        row.pay_statement_deductions,
        Number(row.deductions_total ?? 0),
      );
      const next = {
        gross: previous.gross + Number(row.gross_pay ?? 0),
        tax: previous.tax + Number(deductions.incomeTax ?? 0),
        net: previous.net + Number(row.net_pay ?? 0),
      };

      totalsByEmployee.set(row.employee_id, next);
      totalsByStatement.set(row.id, next);
    });

  return totalsByStatement;
}

function mapStatementToPaystub(
  row: PayStatementRow,
  ytdTotals: { gross: number; tax: number; net: number } | undefined,
): Paystub {
  const grossPay = Number(row.gross_pay ?? 0);
  const deductions = mapDeductionSummary(
    row.pay_statement_deductions,
    Number(row.deductions_total ?? 0),
  );
  const calculation = calculatePayStatementTotals({
    explicitGrossPay: row.gross_pay,
    explicitNetPay: row.net_pay,
    deductionsTotal: row.deductions_total,
    bonusAmount: row.bonus_amount,
    regularHours: row.regular_hours,
    overtimeHours: row.overtime_hours,
    hourlyRate: row.hourly_rate,
    overtimeMultiplier: row.overtime_multiplier,
  });

  return {
    id: row.id,
    employeeId: row.employee_id,
    period: row.period_label,
    periodStartDate: new Date(row.period_start),
    periodEndDate: new Date(row.period_end),
    baseSalary: calculation.regularPay,
    regularHours: calculation.regularHours,
    hourlyRate: calculation.hourlyRate,
    overtimeMultiplier: calculation.overtimeMultiplier,
    grossPay: {
      regularPay: calculation.regularPay,
      overtimePay: calculation.overtimePay,
      bonuses: calculation.bonusAmount,
      allowances: 0,
      total: grossPay,
    },
    deductions,
    netPay: calculation.netPay,
    ytdGross: ytdTotals?.gross ?? grossPay,
    ytdTax: ytdTotals?.tax ?? Number(deductions.incomeTax ?? 0),
    ytdNet: ytdTotals?.net ?? calculation.netPay,
    paymentMethod: row.payment_method ?? DEFAULT_PAYROLL_PAYMENT_METHOD,
    status: mapStatementStatusToPaystubStatus(row.status),
    issuedAt: new Date(row.pay_date),
    paidAt:
      row.status === "paid" || row.status === "archived"
        ? new Date(row.pay_date)
        : undefined,
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function hasHourlyPayrollInputs(body: Record<string, unknown>) {
  return (
    body.regularHours !== undefined ||
    body.overtimeHours !== undefined ||
    body.hourlyRate !== undefined ||
    body.overtimeMultiplier !== undefined
  );
}

async function getFinalizedShiftHoursForPayroll(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  periodStart: string,
  periodEnd: string,
  storeKey: string,
): Promise<
  | {
      regularHours: number;
      overtimeHours: number;
      source: "finalized_attendance" | "unavailable";
    }
  | { error: { message?: string | null } }
> {
  const { data, error } = await supabase
    .from("shift_time_entries")
    .select("entry_date,hours_worked")
    .eq("store_key", storeKey)
    .eq("employee_id", employeeId)
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd)
    .not("clock_out_at", "is", null)
    .not("verified_at", "is", null)
    .returns<FinalizedShiftHoursRow[]>();

  if (error) {
    if (isMissingShiftTrackingError(error)) {
      return {
        regularHours: 0,
        overtimeHours: 0,
        source: "unavailable" as const,
      };
    }

    return {
      error,
    };
  }

  const dailyHours = new Map<string, number>();

  (data ?? []).forEach((row) => {
    dailyHours.set(
      row.entry_date,
      (dailyHours.get(row.entry_date) ?? 0) + Number(row.hours_worked ?? 0),
    );
  });

  let regularHours = 0;

  dailyHours.forEach((hours) => {
    regularHours += hours;
  });

  return {
    regularHours: roundHours(regularHours),
    overtimeHours: 0,
    source: "finalized_attendance" as const,
  };
}

async function getEmployeeStoredHourlyRate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("hourly_rate")
    .eq("id", employeeId)
    .maybeSingle<{ hourly_rate?: number | null }>();

  if (!error) {
    return Number(data?.hourly_rate ?? 0);
  }

  if (isMissingHourlyPayrollFieldsError(error)) {
    return 0;
  }

  console.error("Failed to load stored hourly rate:", error);
  return 0;
}

function buildStatementPayload(
  calculation: ReturnType<typeof calculatePayStatementTotals>,
  paymentMethod: PayrollPaymentMethod = DEFAULT_PAYROLL_PAYMENT_METHOD,
) {
  return {
    payment_method: paymentMethod,
    gross_pay: calculation.grossPay,
    deductions_total: calculation.deductionsTotal,
    net_pay: calculation.netPay,
    regular_hours: calculation.regularHours,
    overtime_hours: 0,
    hourly_rate: calculation.hourlyRate,
    overtime_multiplier: 1,
    bonus_amount: calculation.bonusAmount,
  };
}

function buildLegacyStatementPayload(
  calculation: ReturnType<typeof calculatePayStatementTotals>,
) {
  const payload = buildStatementPayload(calculation) as Record<
    string,
    string | number
  >;

  delete payload.regular_hours;
  delete payload.hourly_rate;
  delete payload.overtime_multiplier;

  return payload;
}

function getUnsupportedTypeResponse(type: string) {
  return NextResponse.json(
    {
      message: `${type} is not backed by Supabase in this release.`,
    },
    { status: 501 },
  );
}

function resolvePayrollPaymentMethod(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PAYROLL_PAYMENT_METHOD;
  }

  return isPayrollPaymentMethod(value) ? value : null;
}

function requestTouchesPayrollAdjustments(input: {
  bonusAmount?: unknown;
  deductions?: Partial<PayrollDeductions>;
}) {
  return input.bonusAmount !== undefined || input.deductions !== undefined;
}

async function getCurrentUserRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role,full_name,permissions")
    .eq("id", userId)
    .single<{
      role: UserRole | null;
      full_name: string | null;
      permissions: string[] | null;
    }>();

  if (error) {
    return { error };
  }

  return {
    role: collapseUserRole(profile?.role ?? "employee"),
    fullName: profile?.full_name ?? null,
    permissions: profile?.permissions ?? null,
  };
}

async function requirePayrollManagerAccess() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return {
      error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
    };
  }

  const roleResult = await getCurrentUserRole(supabase, user.id);

  if ("error" in roleResult) {
    const profileError = roleResult.error;

    return {
      error: NextResponse.json(
        { message: profileError?.message ?? "Failed to load current user" },
        { status: 500 },
      ),
    };
  }

  if (!canAccessPath("/payroll", roleResult.role, roleResult.permissions)) {
    return {
      error: NextResponse.json(
        { message: "Forbidden: admin or manager access required" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { message: "Select a store before managing payroll" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    currentUserId: user.id,
    currentUserRole: roleResult.role,
    currentUserName: roleResult.fullName ?? user.email ?? "User",
    currentUserPermissions: roleResult.permissions,
    activeStoreKey: storeContext.activeStoreKey,
  };
}

async function findOverlappingPayStatement(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  storeKey: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  excludeId?: string | null;
}) {
  const { supabase, storeKey, employeeId, periodStart, periodEnd, excludeId } =
    input;
  let query = supabase
    .from("pay_statements")
    .select("id,employee_id,period_label,period_start,period_end,status")
    .eq("store_key", storeKey)
    .eq("employee_id", employeeId)
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart)
    .in("status", ["draft", "scheduled", "paid"])
    .order("period_start", { ascending: false })
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.returns<OverlappingPayStatementRow[]>();

  if (error) {
    return { error };
  }

  return { data: data?.[0] ?? null };
}

function formatPayrollConflictMessage(statement: OverlappingPayStatementRow) {
  return `Payroll already exists for an overlapping period (${statement.period_label}: ${statement.period_start} to ${statement.period_end}, ${statement.status}). Archive or adjust that statement first.`;
}

async function getPayrollRunLockStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frequency: PayrollFrequency,
  storeKey: string,
  employeeId?: string | null,
  customRange?: {
    periodStart: string;
    periodEnd: string;
    periodLabel?: string | null;
  } | null,
): Promise<PayrollRunLockStatus | { error: PayrollRunStatusError }> {
  const period = customRange
    ? {
        frequency,
        label:
          customRange.periodLabel?.trim() ||
          buildCustomPayrollPeriodLabel(
            customRange.periodStart,
            customRange.periodEnd,
          ),
        periodStart: customRange.periodStart,
        periodEnd: customRange.periodEnd,
        nextAvailableOn: addUtcDaysToIsoDate(customRange.periodEnd, 1),
        isCustomRange: true,
      }
    : {
        ...getLatestAvailablePayrollPeriod(frequency),
        isCustomRange: false,
      };
  let query = supabase
    .from("pay_statements")
    .select("id,employee_id")
    .eq("store_key", storeKey)
    .lte("period_start", period.periodEnd)
    .gte("period_end", period.periodStart)
    .in("status", ["draft", "scheduled", "paid"]);

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const { data, error } = await query.returns<ExistingPayrollTermRow[]>();

  if (error) {
    if (isMissingPayrollFrequencyFieldError(error)) {
      return { error: "migration_required" as const };
    }

    return { error };
  }

  const lockedCount = (data ?? []).length;
  const frequencyLabel = getPayrollFrequencyLabel(frequency);
  const targetLabel = employeeId ? "this employee" : "this term";
  const pendingShiftSummary = await getPendingShiftSummary({
    supabase,
    storeKey,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    employeeId,
  });

  if ("error" in pendingShiftSummary) {
    return { error: pendingShiftSummary.error };
  }

  return {
    frequency,
    periodLabel: period.label,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    nextAvailableOn: period.nextAvailableOn,
    isLocked: lockedCount > 0,
    processedCount: lockedCount,
    lockReason:
      lockedCount > 0
        ? period.isCustomRange
          ? `Payroll already exists for ${targetLabel} between ${period.periodStart} and ${period.periodEnd}. Archive or adjust the overlapping statement first.`
          : `${frequencyLabel} payroll already ran for ${targetLabel} in ${period.label}.`
        : null,
    isCustomRange: period.isCustomRange,
    pendingShiftCount: pendingShiftSummary.pendingShiftCount,
    pendingEmployeeCount: pendingShiftSummary.pendingEmployeeCount,
    warningMessage: pendingShiftSummary.warningMessage,
  };
}

async function getPayrollEmployees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storeKey: string,
  employeeId?: string | null,
) {
  let query = supabase
    .from("profiles")
    .select("id,full_name,email,role,status")
    .neq("role", "admin")
    .eq("store_key", storeKey);

  if (employeeId) {
    const { data, error } = await query
      .eq("id", employeeId)
      .returns<PayrollProfileRow[]>()
      .maybeSingle();

    if (error) {
      return { error };
    }

    if (!data) {
      return {
        error: { message: "Employee not found" },
      };
    }

    return { data: [data] };
  }

  const { data, error } = await query
    .eq("status", "active")
    .order("full_name", { ascending: true })
    .returns<PayrollProfileRow[]>();

  if (error) {
    return { error };
  }

  return { data: data ?? [] };
}

async function createPayrollRun(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  frequency: PayrollFrequency;
  storeKey: string;
  employeeId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodLabel?: string | null;
  paymentMethod: PayrollPaymentMethod;
  bonusAmount?: unknown;
  deductions?: Partial<PayrollDeductions>;
}) {
  const {
    supabase,
    frequency,
    storeKey,
    employeeId,
    periodStart,
    periodEnd,
    periodLabel,
    paymentMethod,
    bonusAmount,
    deductions,
  } = input;
  const deductionRows = buildDeductionRows(deductions);
  const lockStatus = await getPayrollRunLockStatus(
    supabase,
    frequency,
    storeKey,
    employeeId,
    periodStart && periodEnd
      ? {
          periodStart,
          periodEnd,
          periodLabel,
        }
      : null,
  );

  if ("error" in lockStatus) {
    if (lockStatus.error === "migration_required") {
      return {
        response: getPayrollRunUnavailableResponse(),
      };
    }

    const lockError = lockStatus.error;

    return {
      response: NextResponse.json(
        { message: lockError?.message ?? "Failed to load payroll term status" },
        { status: 500 },
      ),
    };
  }

  const periodLock = await assertAccountingPeriodUnlocked(
    supabase,
    storeKey,
    lockStatus.periodEnd,
    `Payroll run ${lockStatus.periodLabel}`,
  );

  if (periodLock) {
    return {
      response: NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      ),
    };
  }

  if (lockStatus.isLocked) {
    return {
      response: NextResponse.json(
        {
          message: lockStatus.lockReason,
          run: lockStatus,
        },
        { status: 409 },
      ),
    };
  }

  if (lockStatus.pendingShiftCount > 0) {
    return {
      response: NextResponse.json(
        {
          message: lockStatus.warningMessage,
          run: lockStatus,
        },
        { status: 409 },
      ),
    };
  }

  const employeesResult = await getPayrollEmployees(
    supabase,
    storeKey,
    employeeId,
  );

  if ("error" in employeesResult) {
    const employeeError = employeesResult.error;
    const statusCode =
      employeeError?.message === "Employee not found" ? 404 : 500;

    return {
      response: NextResponse.json(
        {
          message:
            employeeError?.message ?? "Failed to load employees for payroll",
        },
        { status: statusCode },
      ),
    };
  }

  const employees = (employeesResult.data ?? []).filter(
    (employee) => employee.status === "active",
  );

  if (employeeId && employees.length === 0) {
    return {
      response: NextResponse.json(
        { message: "Selected employee must be active before payroll can run" },
        { status: 400 },
      ),
    };
  }

  if (employees.length === 0) {
    return {
      response: NextResponse.json(
        { message: "No active employees are available for payroll" },
        { status: 400 },
      ),
    };
  }

  const missingRateEmployees: string[] = [];
  const statementPayloads: Array<Record<string, string | number | null>> = [];
  const frequencyLabel = getPayrollFrequencyLabel(frequency);

  for (const employee of employees) {
    const employeeName = (
      employee.full_name ??
      employee.email ??
      "Employee"
    ).trim();
    const finalizedShiftHours = await getFinalizedShiftHoursForPayroll(
      supabase,
      employee.id,
      lockStatus.periodStart,
      lockStatus.periodEnd,
      storeKey,
    );

    if ("error" in finalizedShiftHours) {
      return {
        response: NextResponse.json(
          {
            message:
              finalizedShiftHours.error.message ??
              "Failed to load finalized attendance for payroll",
          },
          { status: 500 },
        ),
      };
    }

    const totalHours = finalizedShiftHours.regularHours;

    if (totalHours <= 0) {
      continue;
    }

    const overlapResult = await findOverlappingPayStatement({
      supabase,
      storeKey,
      employeeId: employee.id,
      periodStart: lockStatus.periodStart,
      periodEnd: lockStatus.periodEnd,
    });

    if ("error" in overlapResult) {
      return {
        response: NextResponse.json(
          {
            message:
              overlapResult.error?.message ??
              "Failed to validate existing payroll statements",
          },
          { status: 500 },
        ),
      };
    }

    if (overlapResult.data) {
      return {
        response: NextResponse.json(
          {
            message: `${employeeName}: ${formatPayrollConflictMessage(overlapResult.data)}`,
          },
          { status: 409 },
        ),
      };
    }

    const hourlyRate = await getEmployeeStoredHourlyRate(supabase, employee.id);

    if (hourlyRate <= 0) {
      missingRateEmployees.push(employeeName);
      continue;
    }

    const calculation = calculatePayStatementTotals({
      bonusAmount,
      deductionsTotal: deductions?.total,
      regularHours: finalizedShiftHours.regularHours,
      overtimeHours: finalizedShiftHours.overtimeHours,
      hourlyRate,
    });

    statementPayloads.push({
      store_key: storeKey,
      employee_id: employee.id,
      period_label: lockStatus.periodLabel,
      period_start: lockStatus.periodStart,
      period_end: lockStatus.periodEnd,
      pay_date: lockStatus.periodEnd,
      pay_frequency: lockStatus.isCustomRange ? null : frequency,
      ...buildStatementPayload(calculation, paymentMethod),
      status: "scheduled",
      notes: lockStatus.isCustomRange
        ? "Custom-range payroll generated from finalized attendance."
        : `${frequencyLabel} payroll generated from finalized attendance.`,
    });
  }

  if (missingRateEmployees.length > 0) {
    return {
      response: NextResponse.json(
        {
          message: `Hourly rate is missing for: ${missingRateEmployees.join(", ")}`,
        },
        { status: 400 },
      ),
    };
  }

  if (statementPayloads.length === 0) {
    return {
      response: NextResponse.json(
        {
          message: `No finalized shift hours are available for ${lockStatus.periodLabel}.`,
        },
        { status: 400 },
      ),
    };
  }

  let { data: statementRows, error: statementError } = await supabase
    .from("pay_statements")
    .insert(statementPayloads)
    .select(PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS)
    .returns<PayStatementRow[]>();

  if (
    statementError &&
    (isMissingHourlyPayrollFieldsError(statementError) ||
      isMissingPayrollFrequencyFieldError(statementError))
  ) {
    return {
      response: getPayrollRunUnavailableResponse(),
    };
  }

  if (statementError) {
    return {
      response: NextResponse.json(
        { message: statementError.message ?? "Failed to create payroll run" },
        { status: 500 },
      ),
    };
  }

  const createdStatements = statementRows ?? [];

  if (deductionRows.length > 0 && createdStatements.length > 0) {
    const { error: deductionsError } = await supabase
      .from("pay_statement_deductions")
      .insert(
        createdStatements.flatMap((statement) =>
          deductionRows.map((row) => ({
            pay_statement_id: statement.id,
            label: row.label,
            amount: row.amount,
            sort_order: row.sort_order,
          })),
        ),
      );

    if (deductionsError) {
      await supabase
        .from("pay_statements")
        .delete()
        .in(
          "id",
          createdStatements.map((statement) => statement.id),
        )
        .eq("store_key", storeKey);

      return {
        response: NextResponse.json(
          {
            message:
              deductionsError.message ??
              "Failed to create payroll run deductions",
          },
          { status: 500 },
        ),
      };
    }
  }

  return {
    payload: {
      run: {
        ...lockStatus,
        processedCount: createdStatements.length,
        employeeCount: createdStatements.length,
        totalGrossPay: createdStatements.reduce(
          (sum, row) => sum + Number(row.gross_pay ?? 0),
          0,
        ),
        totalNetPay: createdStatements.reduce(
          (sum, row) => sum + Number(row.net_pay ?? 0),
          0,
        ),
      },
      paystubs: createdStatements.map((row) =>
        mapStatementToPaystub(row, undefined),
      ),
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const body = await request.json();
    const { type } = body;

    if (!type) {
      return NextResponse.json(
        {
          message:
            "Missing required field: type (timeclock|timesheet|paystub|payroll_run)",
        },
        { status: 400 },
      );
    }

    if (type === "payroll_run") {
      if (!isPayrollFrequency(body.frequency)) {
        return NextResponse.json(
          { message: "Missing or invalid payroll frequency: weekly|monthly" },
          { status: 400 },
        );
      }

      const paymentMethod = resolvePayrollPaymentMethod(body.paymentMethod);

      if (!paymentMethod) {
        return NextResponse.json(
          { message: "Invalid payroll payment method" },
          { status: 400 },
        );
      }

      const bodyRecord = body as Record<string, unknown>;
      const hasCustomPeriodStart = bodyRecord.periodStartDate !== undefined;
      const hasCustomPeriodEnd = bodyRecord.periodEndDate !== undefined;

      if (hasCustomPeriodStart !== hasCustomPeriodEnd) {
        return NextResponse.json(
          {
            message:
              "Provide both periodStartDate and periodEndDate to run payroll for a custom range.",
          },
          { status: 400 },
        );
      }

      const customPeriodStart = hasCustomPeriodStart
        ? toIsoDate(body.periodStartDate)
        : null;
      const customPeriodEnd = hasCustomPeriodEnd
        ? toIsoDate(body.periodEndDate)
        : null;

      if (
        (hasCustomPeriodStart && !customPeriodStart) ||
        (hasCustomPeriodEnd && !customPeriodEnd)
      ) {
        return NextResponse.json(
          { message: "Invalid custom payroll period dates" },
          { status: 400 },
        );
      }

      if (
        customPeriodStart &&
        customPeriodEnd &&
        customPeriodStart > customPeriodEnd
      ) {
        return NextResponse.json(
          {
            message:
              "Payroll period start date must be on or before the end date.",
          },
          { status: 400 },
        );
      }

      const access = await requirePayrollManagerAccess();

      if (access.error) {
        return access.error;
      }

      const requestedDeductions =
        body.deductions && typeof body.deductions === "object"
          ? (body.deductions as Partial<PayrollDeductions>)
          : undefined;
      const requestedBonusAmount = body.grossPay?.bonuses ?? body.bonusAmount;

      if (
        requestTouchesPayrollAdjustments({
          bonusAmount: requestedBonusAmount,
          deductions: requestedDeductions,
        })
      ) {
        if (!body.employeeId) {
          return NextResponse.json(
            {
              message:
                "Bonus and deduction adjustments can only be applied when running payroll for a single employee.",
            },
            { status: 400 },
          );
        }

        if (
          !canManagePayrollAdjustments(
            access.currentUserRole,
            access.currentUserPermissions,
          )
        ) {
          return NextResponse.json(
            {
              message:
                "Forbidden: payroll adjustment access required for bonus or deduction changes.",
            },
            { status: 403 },
          );
        }
      }

      const runResult = await createPayrollRun({
        supabase: access.supabase,
        frequency: body.frequency,
        storeKey: access.activeStoreKey,
        employeeId:
          typeof body.employeeId === "string" &&
          body.employeeId.trim().length > 0
            ? body.employeeId
            : null,
        periodStart: customPeriodStart,
        periodEnd: customPeriodEnd,
        periodLabel:
          typeof body.periodLabel === "string" &&
          body.periodLabel.trim().length > 0
            ? body.periodLabel.trim()
            : null,
        paymentMethod,
        bonusAmount: requestedBonusAmount,
        deductions: requestedDeductions,
      });

      if (runResult.response) {
        return runResult.response;
      }

      if (!("payload" in runResult)) {
        return NextResponse.json(
          { message: "Payroll run could not be created" },
          { status: 500 },
        );
      }

      await appendAuditEvent({
        supabase: access.supabase,
        storeKey: access.activeStoreKey,
        entityType: "payroll_run",
        entityId: `${runResult.payload.run.periodStart}:${runResult.payload.run.periodEnd}:${runResult.payload.run.frequency}`,
        action: "payroll.run_created",
        summary: `Payroll run created for ${runResult.payload.run.periodLabel}`,
        actorId: access.currentUserId,
        actorName: access.currentUserName,
        actorRole: access.currentUserRole,
        metadata: {
          employeeCount: runResult.payload.run.employeeCount,
          frequency: runResult.payload.run.frequency,
          isCustomRange: runResult.payload.run.isCustomRange,
          paystubIds: runResult.payload.paystubs.map((paystub) => paystub.id),
          paymentMethod,
          periodEnd: runResult.payload.run.periodEnd,
          periodLabel: runResult.payload.run.periodLabel,
          periodStart: runResult.payload.run.periodStart,
          totalGrossPay: runResult.payload.run.totalGrossPay,
          totalNetPay: runResult.payload.run.totalNetPay,
        },
      });

      return NextResponse.json(runResult.payload, { status: 201 });
    }

    if (type !== "paystub") {
      return getUnsupportedTypeResponse(type);
    }

    if (
      !body.employeeId ||
      !body.period ||
      !body.periodStartDate ||
      !body.periodEndDate
    ) {
      return NextResponse.json(
        {
          message:
            "Missing required fields for paystub: employeeId, period, periodStartDate, periodEndDate",
        },
        { status: 400 },
      );
    }

    const access = await requirePayrollManagerAccess();

    if (access.error) {
      return access.error;
    }

    const { supabase, activeStoreKey } = access;
    const requestedDeductions =
      body.deductions && typeof body.deductions === "object"
        ? (body.deductions as Partial<PayrollDeductions>)
        : undefined;
    const requestedBonusAmount = body.grossPay?.bonuses ?? body.bonusAmount;

    if (
      requestTouchesPayrollAdjustments({
        bonusAmount: requestedBonusAmount,
        deductions: requestedDeductions,
      }) &&
      !canManagePayrollAdjustments(
        access.currentUserRole,
        access.currentUserPermissions,
      )
    ) {
      return NextResponse.json(
        {
          message:
            "Forbidden: payroll adjustment access required for bonus or deduction changes.",
        },
        { status: 403 },
      );
    }

    const bodyRecord = body as Record<string, unknown>;
    const periodStart = toIsoDate(body.periodStartDate);
    const periodEnd = toIsoDate(body.periodEndDate);

    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { message: "Invalid payroll period dates" },
        { status: 400 },
      );
    }

    if (periodStart > periodEnd) {
      return NextResponse.json(
        {
          message:
            "Payroll period start date must be on or before the end date",
        },
        { status: 400 },
      );
    }

    const pendingShiftSummary = await getPendingShiftSummary({
      supabase,
      storeKey: activeStoreKey,
      employeeId: String(body.employeeId),
      periodStart,
      periodEnd,
    });

    if ("error" in pendingShiftSummary) {
      return NextResponse.json(
        {
          message:
            pendingShiftSummary.error.message ??
            "Failed to inspect pending attendance for payroll",
        },
        { status: 500 },
      );
    }

    if (pendingShiftSummary.pendingShiftCount > 0) {
      return NextResponse.json(
        {
          message: pendingShiftSummary.warningMessage,
          pendingShiftCount: pendingShiftSummary.pendingShiftCount,
        },
        { status: 409 },
      );
    }

    const finalizedShiftHours =
      !hasHourlyPayrollInputs(bodyRecord) && periodStart && periodEnd
        ? await getFinalizedShiftHoursForPayroll(
            supabase,
            String(body.employeeId),
            periodStart,
            periodEnd,
            activeStoreKey,
          )
        : null;

    if (finalizedShiftHours && "error" in finalizedShiftHours) {
      return NextResponse.json(
        {
          message:
            finalizedShiftHours.error.message ??
            "Failed to load finalized attendance for payroll",
        },
        { status: 500 },
      );
    }

    const payDate =
      toIsoDate(body.paidAt) ??
      toIsoDate(body.issuedAt) ??
      toIsoDate(body.periodEndDate);
    const periodLock = await assertAccountingPeriodUnlocked(
      supabase,
      activeStoreKey,
      payDate,
      `Payroll ${body.period}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      );
    }

    const overlapResult = await findOverlappingPayStatement({
      supabase,
      storeKey: activeStoreKey,
      employeeId: String(body.employeeId),
      periodStart,
      periodEnd,
    });

    if ("error" in overlapResult) {
      return NextResponse.json(
        {
          message:
            overlapResult.error?.message ??
            "Failed to validate existing payroll statements",
        },
        { status: 500 },
      );
    }

    if (overlapResult.data) {
      return NextResponse.json(
        { message: formatPayrollConflictMessage(overlapResult.data) },
        { status: 409 },
      );
    }

    const requestedHourlyRate =
      bodyRecord.hourlyRate === undefined
        ? await getEmployeeStoredHourlyRate(supabase, String(body.employeeId))
        : bodyRecord.hourlyRate;
    const paymentMethod = resolvePayrollPaymentMethod(body.paymentMethod);

    if (!paymentMethod) {
      return NextResponse.json(
        { message: "Invalid payroll payment method" },
        { status: 400 },
      );
    }
    const calculation = calculatePayStatementTotals({
      explicitGrossPay: body.grossPay?.total ?? body.baseSalary,
      explicitNetPay: body.netPay,
      deductionsTotal: body.deductions?.total ?? body.deductionsTotal,
      bonusAmount: body.grossPay?.bonuses ?? body.bonusAmount,
      regularHours:
        bodyRecord.regularHours ??
        (finalizedShiftHours && !("error" in finalizedShiftHours)
          ? finalizedShiftHours.regularHours
          : undefined),
      overtimeHours:
        bodyRecord.overtimeHours ??
        (finalizedShiftHours && !("error" in finalizedShiftHours)
          ? finalizedShiftHours.overtimeHours
          : undefined),
      hourlyRate: requestedHourlyRate,
      overtimeMultiplier: bodyRecord.overtimeMultiplier,
    });

    if (
      hasHourlyPayrollInputs(bodyRecord) &&
      calculation.hourlyRate <= 0 &&
      (calculation.regularHours > 0 || calculation.overtimeHours > 0)
    ) {
      return NextResponse.json(
        { message: "Hourly rate is required when payroll hours are provided" },
        { status: 400 },
      );
    }

    if (
      !calculation.usesHourlyCalculation &&
      body.grossPay?.total === undefined &&
      body.baseSalary === undefined
    ) {
      if (finalizedShiftHours && !("error" in finalizedShiftHours)) {
        if (finalizedShiftHours.source === "unavailable") {
          return NextResponse.json(
            {
              message:
                "Finalized attendance records are unavailable in this environment. Apply the latest shift tracking migrations or provide explicit pay values.",
            },
            { status: 503 },
          );
        }

        return NextResponse.json(
          {
            message: `No finalized shift hours are available between ${periodStart} and ${periodEnd}.`,
          },
          { status: 400 },
        );
      }

      return NextResponse.json(
        {
          message:
            "Provide either gross pay details or finalized attendance to create a paystub",
        },
        { status: 400 },
      );
    }

    const statementPayload = {
      store_key: activeStoreKey,
      employee_id: body.employeeId,
      period_label: body.period,
      period_start: toIsoDate(body.periodStartDate),
      period_end: toIsoDate(body.periodEndDate),
      pay_date: payDate,
      ...buildStatementPayload(calculation, paymentMethod),
      status: mapPaystubStatusToStatementStatus(body.status),
      notes: body.notes ?? null,
    };

    const legacyStatementPayload = {
      store_key: activeStoreKey,
      employee_id: body.employeeId,
      period_label: body.period,
      period_start: toIsoDate(body.periodStartDate),
      period_end: toIsoDate(body.periodEndDate),
      pay_date: payDate,
      ...buildLegacyStatementPayload(calculation),
      status: mapPaystubStatusToStatementStatus(body.status),
      notes: body.notes ?? null,
    };

    let { data: statementRow, error: statementError } = await supabase
      .from("pay_statements")
      .insert(statementPayload)
      .select(PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS)
      .returns<PayStatementRow[]>()
      .single();

    if (statementError && isMissingHourlyPayrollFieldsError(statementError)) {
      ({ data: statementRow, error: statementError } = await supabase
        .from("pay_statements")
        .insert(legacyStatementPayload)
        .select(PAY_STATEMENT_SELECT_BASE)
        .returns<PayStatementRow[]>()
        .single());
    }

    if (statementError || !statementRow) {
      return NextResponse.json(
        { message: statementError?.message ?? "Failed to create paystub" },
        { status: 500 },
      );
    }

    const deductionRows = buildDeductionRows(requestedDeductions);

    if (deductionRows.length > 0) {
      const { error: deductionsError } = await supabase
        .from("pay_statement_deductions")
        .insert(
          deductionRows.map((row) => ({
            pay_statement_id: statementRow.id,
            label: row.label,
            amount: row.amount,
            sort_order: row.sort_order,
          })),
        );

      if (deductionsError) {
        await supabase
          .from("pay_statements")
          .delete()
          .eq("id", statementRow.id)
          .eq("store_key", activeStoreKey);

        return NextResponse.json(
          {
            message:
              deductionsError.message ?? "Failed to create paystub deductions",
          },
          { status: 500 },
        );
      }
    }

    const responseRow: PayStatementRow = {
      ...statementRow,
      pay_statement_deductions: deductionRows.map((row, index) => ({
        id: `${statementRow.id}-deduction-${index}`,
        label: row.label,
        amount: row.amount,
        sort_order: row.sort_order,
      })),
    };

    await appendAuditEvent({
      supabase,
      storeKey: activeStoreKey,
      entityType: "pay_statement",
      entityId: statementRow.id,
      action: "payroll.created",
      summary: `Paystub created: ${body.period}`,
      actorId: access.currentUserId,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        employeeId: body.employeeId,
        periodLabel: body.period,
        periodStart,
        periodEnd,
        payDate,
        status: statementPayload.status,
        paymentMethod,
        grossPay: calculation.grossPay,
        netPay: calculation.netPay,
        source:
          finalizedShiftHours && !("error" in finalizedShiftHours)
            ? finalizedShiftHours.source
            : "explicit_values",
      },
    });

    return NextResponse.json(mapStatementToPaystub(responseRow, undefined), {
      status: 201,
    });
  } catch (error) {
    console.error("Payroll POST error:", error);
    return NextResponse.json(
      { message: "Failed to create payroll record" },
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
    const type = searchParams.get("type");
    const employeeId = searchParams.get("employeeId");
    const period = searchParams.get("period");

    if (!type) {
      return NextResponse.json(
        { message: "Missing required query: type" },
        { status: 400 },
      );
    }

    if (type === "run_status") {
      const access = await requirePayrollManagerAccess();

      if (access.error) {
        return access.error;
      }

      const [weeklyStatus, monthlyStatus] = await Promise.all([
        getPayrollRunLockStatus(
          access.supabase,
          "weekly",
          access.activeStoreKey,
          employeeId,
        ),
        getPayrollRunLockStatus(
          access.supabase,
          "monthly",
          access.activeStoreKey,
          employeeId,
        ),
      ]);

      const statusError =
        ("error" in weeklyStatus && weeklyStatus.error) ||
        ("error" in monthlyStatus && monthlyStatus.error);

      if (statusError) {
        if (statusError === "migration_required") {
          return getPayrollRunUnavailableResponse();
        }

        return NextResponse.json(
          {
            message:
              (typeof statusError === "object" ? statusError.message : null) ??
              "Failed to load payroll run status",
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        weekly: weeklyStatus,
        monthly: monthlyStatus,
      });
    }

    if (type !== "paystub") {
      return getUnsupportedTypeResponse(type);
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const roleResult = await getCurrentUserRole(supabase, user.id);

    if ("error" in roleResult) {
      const profileError = roleResult.error;

      return NextResponse.json(
        { message: profileError?.message ?? "Failed to load current user" },
        { status: 500 },
      );
    }

    const canViewManagedPayroll = canAccessPath(
      "/payroll",
      roleResult.role,
      roleResult.permissions,
    );
    const canViewOwnPayroll = canAccessPath(
      "/employee/payroll",
      roleResult.role,
      roleResult.permissions,
    );

    if (!canViewManagedPayroll && !canViewOwnPayroll) {
      return NextResponse.json(
        { message: "Forbidden: payroll access denied" },
        { status: 403 },
      );
    }

    if (!canViewManagedPayroll && employeeId && employeeId !== user.id) {
      return NextResponse.json(
        { message: "Forbidden: payroll access denied" },
        { status: 403 },
      );
    }

    const storeResult = await getActiveStoreKey();

    if ("error" in storeResult) {
      return storeResult.error;
    }

    const { activeStoreKey } = storeResult;

    const { data, error } = await selectPayStatementsWithFallback<
      PayStatementRow[]
    >(async (select) => {
      let query = supabase
        .from("pay_statements")
        .select(
          `${select},pay_statement_deductions(id,label,amount,sort_order)`,
        )
        .eq("store_key", activeStoreKey)
        .order("pay_date", { ascending: false });

      if (canViewManagedPayroll) {
        if (employeeId) {
          query = query.eq("employee_id", employeeId);
        }
      } else {
        query = query.eq("employee_id", user.id);
      }

      if (period) {
        query = query.eq("period_label", period);
      }

      return query.returns<PayStatementRow[]>();
    });

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to fetch payroll records" },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const ytdTotals = buildYtdTotals(rows);

    return NextResponse.json(
      rows.map((row) => mapStatementToPaystub(row, ytdTotals.get(row.id))),
    );
  } catch (error) {
    console.error("Payroll GET error:", error);
    return NextResponse.json(
      { message: "Failed to fetch payroll records" },
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
    const { type, id, data } = body;

    if (!type || !id) {
      return NextResponse.json(
        { message: "Missing required fields: type, id" },
        { status: 400 },
      );
    }

    if (type !== "paystub") {
      return getUnsupportedTypeResponse(type);
    }

    const access = await requirePayrollManagerAccess();

    if (access.error) {
      return access.error;
    }

    const { supabase, activeStoreKey } = access;
    const requestedDeductions =
      data?.deductions && typeof data.deductions === "object"
        ? (data.deductions as Partial<PayrollDeductions>)
        : undefined;
    const requestedBonusAmount = data?.grossPay?.bonuses ?? data?.bonusAmount;

    if (
      requestTouchesPayrollAdjustments({
        bonusAmount: requestedBonusAmount,
        deductions: requestedDeductions,
      }) &&
      !canManagePayrollAdjustments(
        access.currentUserRole,
        access.currentUserPermissions,
      )
    ) {
      return NextResponse.json(
        {
          message:
            "Forbidden: payroll adjustment access required for bonus or deduction changes.",
        },
        { status: 403 },
      );
    }

    const dataRecord = data as Record<string, unknown>;
    const { data: currentStatement, error: currentStatementError } =
      await selectPayStatementsWithFallback<PayStatementRow>(async (select) =>
        supabase
          .from("pay_statements")
          .select(select)
          .eq("id", id)
          .eq("store_key", activeStoreKey)
          .returns<PayStatementRow[]>()
          .single(),
      );

    if (currentStatementError || !currentStatement) {
      const statusCode = currentStatementError?.code === "PGRST116" ? 404 : 500;
      return NextResponse.json(
        {
          message: currentStatementError?.message ?? "Payroll record not found",
        },
        { status: statusCode },
      );
    }

    if (currentStatement.status === "archived") {
      return NextResponse.json(
        {
          message:
            "Archived payroll statements are read-only. Create a replacement statement if changes are required.",
        },
        { status: 409 },
      );
    }

    const resolvedHourlyRate =
      dataRecord.hourlyRate === undefined
        ? Number(currentStatement.hourly_rate ?? 0) ||
          (await getEmployeeStoredHourlyRate(
            supabase,
            currentStatement.employee_id,
          ))
        : dataRecord.hourlyRate;
    const calculation = calculatePayStatementTotals({
      explicitGrossPay:
        data.grossPay?.total ?? data.baseSalary ?? currentStatement.gross_pay,
      explicitNetPay: data.netPay,
      deductionsTotal:
        data.deductions?.total ??
        data.deductionsTotal ??
        currentStatement.deductions_total,
      bonusAmount:
        data.grossPay?.bonuses ??
        data.bonusAmount ??
        currentStatement.bonus_amount,
      regularHours: dataRecord.regularHours ?? currentStatement.regular_hours,
      overtimeHours:
        dataRecord.overtimeHours ?? currentStatement.overtime_hours,
      hourlyRate: resolvedHourlyRate,
      overtimeMultiplier:
        dataRecord.overtimeMultiplier ?? currentStatement.overtime_multiplier,
    });

    if (
      hasHourlyPayrollInputs(dataRecord) &&
      calculation.hourlyRate <= 0 &&
      (calculation.regularHours > 0 || calculation.overtimeHours > 0)
    ) {
      return NextResponse.json(
        { message: "Hourly rate is required when payroll hours are provided" },
        { status: 400 },
      );
    }

    const updateDate =
      toIsoDate(data.paidAt) ??
      toIsoDate(data.issuedAt) ??
      currentStatement.pay_date;
    const periodLock = await assertAccountingPeriodUnlocked(
      supabase,
      activeStoreKey,
      updateDate,
      `Payroll ${currentStatement.period_label}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      );
    }

    const updatePayload: Record<string, string | number | null> = {
      ...buildStatementPayload(
        calculation,
        currentStatement.payment_method ?? DEFAULT_PAYROLL_PAYMENT_METHOD,
      ),
    };

    const legacyUpdatePayload: Record<string, string | number | null> = {
      ...buildLegacyStatementPayload(calculation),
    };

    if (data.period) {
      updatePayload.period_label = data.period;
      legacyUpdatePayload.period_label = data.period;
    }
    if (data.periodStartDate) {
      const periodStart = toIsoDate(data.periodStartDate);
      updatePayload.period_start = periodStart;
      legacyUpdatePayload.period_start = periodStart;
    }
    if (data.periodEndDate) {
      const periodEnd = toIsoDate(data.periodEndDate);
      updatePayload.period_end = periodEnd;
      legacyUpdatePayload.period_end = periodEnd;
    }
    if (data.paidAt || data.issuedAt) {
      const payDate = toIsoDate(data.paidAt) ?? toIsoDate(data.issuedAt);
      updatePayload.pay_date = payDate;
      legacyUpdatePayload.pay_date = payDate;
    }
    if (data.status !== undefined) {
      const status = mapPaystubStatusToStatementStatus(data.status);
      updatePayload.status = status;
      legacyUpdatePayload.status = status;
      if (status === "archived") {
        updatePayload.archived_by = access.currentUserId;
        updatePayload.archived_at = new Date().toISOString();
      } else {
        updatePayload.archived_by = null;
        updatePayload.archived_at = null;
      }
    }
    if (data.notes !== undefined) {
      updatePayload.notes = data.notes ?? null;
      legacyUpdatePayload.notes = data.notes ?? null;
    }
    if (data.paymentMethod !== undefined) {
      const paymentMethod = resolvePayrollPaymentMethod(data.paymentMethod);

      if (!paymentMethod) {
        return NextResponse.json(
          { message: "Invalid payroll payment method" },
          { status: 400 },
        );
      }

      updatePayload.payment_method = paymentMethod;
      legacyUpdatePayload.payment_method = paymentMethod;
    }

    const nextPeriodStart =
      typeof updatePayload.period_start === "string"
        ? updatePayload.period_start
        : currentStatement.period_start;
    const nextPeriodEnd =
      typeof updatePayload.period_end === "string"
        ? updatePayload.period_end
        : currentStatement.period_end;

    if (nextPeriodStart > nextPeriodEnd) {
      return NextResponse.json(
        {
          message:
            "Payroll period start date must be on or before the end date",
        },
        { status: 400 },
      );
    }

    const overlapResult = await findOverlappingPayStatement({
      supabase,
      storeKey: activeStoreKey,
      employeeId: currentStatement.employee_id,
      periodStart: nextPeriodStart,
      periodEnd: nextPeriodEnd,
      excludeId: currentStatement.id,
    });

    if ("error" in overlapResult) {
      return NextResponse.json(
        {
          message:
            overlapResult.error?.message ??
            "Failed to validate existing payroll statements",
        },
        { status: 500 },
      );
    }

    if (overlapResult.data) {
      return NextResponse.json(
        { message: formatPayrollConflictMessage(overlapResult.data) },
        { status: 409 },
      );
    }

    let { error: updateError } = await supabase
      .from("pay_statements")
      .update(updatePayload)
      .eq("id", id)
      .eq("store_key", activeStoreKey);

    if (updateError && isMissingHourlyPayrollFieldsError(updateError)) {
      ({ error: updateError } = await supabase
        .from("pay_statements")
        .update(legacyUpdatePayload)
        .eq("id", id)
        .eq("store_key", activeStoreKey));
    }

    if (updateError) {
      const statusCode = updateError.code === "PGRST116" ? 404 : 500;
      return NextResponse.json(
        { message: updateError.message ?? "Failed to update payroll record" },
        { status: statusCode },
      );
    }

    if (data.deductions) {
      const { error: deleteError } = await supabase
        .from("pay_statement_deductions")
        .delete()
        .eq("pay_statement_id", id);

      if (deleteError) {
        return NextResponse.json(
          { message: deleteError.message ?? "Failed to update deductions" },
          { status: 500 },
        );
      }

      const deductionRows = buildDeductionRows(requestedDeductions);

      if (deductionRows.length > 0) {
        const { error: insertError } = await supabase
          .from("pay_statement_deductions")
          .insert(
            deductionRows.map((row) => ({
              pay_statement_id: id,
              label: row.label,
              amount: row.amount,
              sort_order: row.sort_order,
            })),
          );

        if (insertError) {
          return NextResponse.json(
            { message: insertError.message ?? "Failed to update deductions" },
            { status: 500 },
          );
        }
      }
    }

    const { data: statementRow, error: selectError } =
      await selectPayStatementsWithFallback<PayStatementRow>(async (select) =>
        supabase
          .from("pay_statements")
          .select(
            `${select},pay_statement_deductions(id,label,amount,sort_order)`,
          )
          .eq("id", id)
          .eq("store_key", activeStoreKey)
          .returns<PayStatementRow[]>()
          .single(),
      );

    if (selectError || !statementRow) {
      return NextResponse.json(
        {
          message:
            selectError?.message ?? "Failed to fetch updated payroll record",
        },
        { status: 500 },
      );
    }

    const nextStatus = updatePayload.status ?? currentStatement.status;
    await appendAuditEvent({
      supabase,
      storeKey: activeStoreKey,
      entityType: "pay_statement",
      entityId: id,
      action:
        nextStatus === "archived"
          ? "payroll.archived"
          : data.status !== undefined
            ? "payroll.status_updated"
            : "payroll.updated",
      summary:
        nextStatus === "archived"
          ? `Payroll archived: ${currentStatement.period_label}`
          : data.status !== undefined
            ? `Payroll status updated: ${currentStatement.period_label}`
            : `Payroll updated: ${currentStatement.period_label}`,
      actorId: access.currentUserId,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        employeeId: currentStatement.employee_id,
        periodLabel: currentStatement.period_label,
        previousStatus: currentStatement.status,
        nextStatus,
      },
    });

    return NextResponse.json(mapStatementToPaystub(statementRow, undefined));
  } catch (error) {
    console.error("Payroll PATCH error:", error);
    return NextResponse.json(
      { message: "Failed to update payroll record" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return getConfigurationError();
    }

    const type = request.nextUrl.searchParams.get("type")?.trim() ?? "";
    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";

    if (!type || !id) {
      return NextResponse.json(
        { message: "Missing required fields: type, id" },
        { status: 400 },
      );
    }

    if (type !== "paystub") {
      return getUnsupportedTypeResponse(type);
    }

    const access = await requirePayrollManagerAccess();

    if (access.error) {
      return access.error;
    }

    const { data: currentStatement, error: currentStatementError } =
      await selectPayStatementsWithFallback<PayStatementRow>(async (select) =>
        access.supabase
          .from("pay_statements")
          .select(select)
          .eq("id", id)
          .eq("store_key", access.activeStoreKey)
          .returns<PayStatementRow[]>()
          .single(),
      );

    if (currentStatementError || !currentStatement) {
      const statusCode = currentStatementError?.code === "PGRST116" ? 404 : 500;
      return NextResponse.json(
        {
          message: currentStatementError?.message ?? "Payroll record not found",
        },
        { status: statusCode },
      );
    }

    if (currentStatement.status === "archived") {
      return NextResponse.json({ success: true, id: currentStatement.id });
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      currentStatement.pay_date,
      `Payroll ${currentStatement.period_label}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { message: periodLock.error },
        { status: periodLock.status },
      );
    }

    const { data, error } = await access.supabase
      .from("pay_statements")
      .update({
        status: "archived",
        archived_by: access.currentUserId,
        archived_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      const statusCode = error.code === "PGRST116" ? 404 : 500;
      return NextResponse.json(
        { message: error.message ?? "Failed to archive payroll record" },
        { status: statusCode },
      );
    }

    if (!data) {
      return NextResponse.json(
        { message: "Payroll record not found" },
        { status: 404 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "pay_statement",
      entityId: data.id,
      action: "payroll.archived",
      summary: `Payroll archived: ${currentStatement.period_label}`,
      actorId: access.currentUserId,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        employeeId: currentStatement.employee_id,
        periodLabel: currentStatement.period_label,
        previousStatus: currentStatement.status,
        nextStatus: "archived",
      },
    });

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Payroll DELETE error:", error);
    return NextResponse.json(
      { message: "Failed to archive payroll record" },
      { status: 500 },
    );
  }
}
