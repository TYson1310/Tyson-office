import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StoreScopeBanner } from "@/components/erp/store-scope-banner";
import { DeletePayrollButton } from "@/components/payroll/delete-payroll-button";
import { PayrollStatementEditor } from "@/components/payroll/payroll-statement-editor";
import { PayrollStatusEditor } from "@/components/payroll/payroll-status-editor";
import { StatusBadge } from "@/components/erp/status-badge";
import { payrollStatusTone } from "@/components/erp/tone-maps";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { canAccessPath } from "@/lib/auth/route-access";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { requireCurrentUser } from "@/lib/auth/session";
import {
  formatCurrency,
  formatDate,
  getOperationsDataset,
} from "@/lib/erp/operations";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { selectPayStatementsWithFallback } from "@/lib/payroll/pay-statements";
import { formatPayrollPaymentMethod } from "@/lib/payroll/payment-methods";
import { canManagePayrollAdjustments } from "@/lib/payroll/permissions";
import { redirect } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payroll",
};

type PayrollRunRow = {
  id: string;
  employee_id: string;
  period_label: string;
  pay_date: string;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
  bonus_amount?: number | null;
  regular_hours?: number | null;
  overtime_hours?: number | null;
  hourly_rate?: number | null;
  payment_method?: string | null;
  pay_statement_deductions?: Array<{
    id: string;
    label: string;
    amount: number;
    sort_order: number | null;
  }> | null;
  status: "draft" | "scheduled" | "paid" | "archived";
};

type CurrentPayrollStaffDue = {
  employeeId: string;
  employeeName: string;
  roleLabel: string;
  periodLabels: string[];
  payDate: Date;
  dueStatus: "Draft" | "Scheduled" | "Overdue";
  totalHours: number;
  totalDue: number;
  statementCount: number;
};

function mapPayrollDueTone(dueStatus: "Draft" | "Scheduled" | "Overdue") {
  if (dueStatus === "Overdue" || dueStatus === "Draft") {
    return "red" as const;
  }

  return "amber" as const;
}

function mapPayrollStatus(status: PayrollRunRow["status"]) {
  if (status === "archived") {
    return "Archived" as const;
  }

  if (status === "paid") {
    return "Paid" as const;
  }

  if (status === "draft") {
    return "Draft" as const;
  }

  return "Scheduled" as const;
}

function getPayrollDueStatus(run: PayrollRunRow, todayDateKey: string) {
  if (run.status === "draft") {
    return "Draft" as const;
  }

  return run.pay_date < todayDateKey
    ? ("Overdue" as const)
    : ("Scheduled" as const);
}

function getDueStatusPriority(status: CurrentPayrollStaffDue["dueStatus"]) {
  if (status === "Overdue") {
    return 3;
  }

  if (status === "Draft") {
    return 2;
  }

  return 1;
}

function getPayrollRunHours(run: PayrollRunRow) {
  return Number(run.regular_hours ?? 0) + Number(run.overtime_hours ?? 0);
}

function formatPeriodSummary(periodLabels: string[]) {
  const uniqueLabels = Array.from(new Set(periodLabels));

  if (uniqueLabels.length <= 2) {
    return uniqueLabels.join(", ");
  }

  return `${uniqueLabels.length} open statements`;
}

export default async function PayrollPage() {
  const auth = await requireCurrentUser();

  if (!canAccessPath("/payroll", auth.appUser.role, auth.appUser.permissions)) {
    redirect(
      getPostLoginRedirectPath(
        auth.appUser.role,
        auth.appUser.storeKey,
        auth.appUser.permissions,
      ),
    );
  }

  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const canManagePayrollStatements =
    auth.appUser.role === "admin" || auth.appUser.role === "manager";
  const canManageStatementAdjustments = canManagePayrollAdjustments(
    auth.appUser.role,
    auth.appUser.permissions,
  );
  const employeeMap = new Map(
    dataset.employees.map((employee) => [employee.id, employee]),
  );
  let payrollRows: PayrollRunRow[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await selectPayStatementsWithFallback<PayrollRunRow[]>(
      async (select) =>
        supabase
          .from("pay_statements")
          .select(
            `${select},pay_statement_deductions(id,label,amount,sort_order)`,
          )
          .eq("store_key", activeStoreKey)
          .order("pay_date", { ascending: false })
          .returns<PayrollRunRow[]>(),
    );

    payrollRows = data ?? [];
  }

  const recentRuns = payrollRows;
  const activeRuns = recentRuns.filter(
    (row) => row.status !== "paid" && row.status !== "archived",
  );
  const latestRun = recentRuns[0] ?? null;
  const grossPayroll = recentRuns.reduce(
    (sum, row) => sum + Number(row.gross_pay ?? 0),
    0,
  );
  const netPayroll = recentRuns.reduce(
    (sum, row) => sum + Number(row.net_pay ?? 0),
    0,
  );
  const currentPayrollHours = activeRuns.reduce(
    (sum, row) => sum + getPayrollRunHours(row),
    0,
  );
  const approvalsPending = activeRuns.length;
  const employeesCovered = new Set(recentRuns.map((row) => row.employee_id))
    .size;
  const missingPayFrequency = dataset.employees.filter(
    (employee) => !employee.payFrequency,
  ).length;
  const todayDateKey = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const payrollDuesByStaff = activeRuns.reduce<
    Map<string, CurrentPayrollStaffDue>
  >((accumulator, run) => {
    const employee = employeeMap.get(run.employee_id);
    const dueStatus = getPayrollDueStatus(run, todayDateKey);
    const existing = accumulator.get(run.employee_id);

    if (!existing) {
      accumulator.set(run.employee_id, {
        employeeId: run.employee_id,
        employeeName: employee?.name ?? "Employee",
        roleLabel: employee?.positionTitle ?? employee?.role ?? "-",
        periodLabels: [run.period_label],
        payDate: new Date(run.pay_date),
        dueStatus,
        totalHours: getPayrollRunHours(run),
        totalDue: Number(run.net_pay ?? 0),
        statementCount: 1,
      });
      return accumulator;
    }

    const nextStatus =
      getDueStatusPriority(dueStatus) > getDueStatusPriority(existing.dueStatus)
        ? dueStatus
        : existing.dueStatus;

    accumulator.set(run.employee_id, {
      ...existing,
      periodLabels: [...existing.periodLabels, run.period_label],
      payDate:
        new Date(run.pay_date).getTime() < existing.payDate.getTime()
          ? new Date(run.pay_date)
          : existing.payDate,
      dueStatus: nextStatus,
      totalHours: existing.totalHours + getPayrollRunHours(run),
      totalDue: existing.totalDue + Number(run.net_pay ?? 0),
      statementCount: existing.statementCount + 1,
    });

    return accumulator;
  }, new Map());
  const payrollDues = Array.from(payrollDuesByStaff.values())
    .map((due) => ({
      ...due,
      periodSummary: formatPeriodSummary(due.periodLabels),
    }))
    .sort((left, right) => left.payDate.getTime() - right.payDate.getTime());
  const totalPayrollDue = payrollDues.reduce(
    (sum, due) => sum + due.totalDue,
    0,
  );
  const payrollEvents = recentRuns.slice(0, 6).map((row) => ({
    id: row.id,
    title: row.period_label,
    payDate: formatDate(new Date(row.pay_date)),
    employeeName: employeeMap.get(row.employee_id)?.name ?? "Employee",
  }));
  const payrollAlerts = [
    approvalsPending > 0
      ? `${approvalsPending} payroll statement${approvalsPending === 1 ? "" : "s"} still need approval or release.`
      : "No payroll approvals are currently pending.",
    missingPayFrequency > 0
      ? `${missingPayFrequency} employee profile${missingPayFrequency === 1 ? "" : "s"} are missing a pay frequency setting.`
      : "All employee profiles have a pay frequency configured.",
    employeesCovered > 0
      ? `${employeesCovered} employee${employeesCovered === 1 ? "" : "s"} are included in the recent payroll history.`
      : "No payroll statements are available yet.",
  ];
  const payrollMetrics = [
    {
      label: "Latest period",
      value: latestRun?.period_label ?? "No payrolls yet",
      change: latestRun
        ? formatDate(new Date(latestRun.pay_date))
        : "No pay date",
      detail: "most recent payroll statement",
      tone: "blue" as const,
    },
    {
      label: "Gross payroll",
      value: formatCurrency(grossPayroll),
      change: `${recentRuns.length} statement${recentRuns.length === 1 ? "" : "s"}`,
      detail: "recent payroll history total",
      tone: "green" as const,
    },
    {
      label: "Current payroll hours",
      value: `${currentPayrollHours.toFixed(1)} hrs`,
      change: `${payrollDues.length} staff due`,
      detail: "draft and scheduled payroll hours",
      tone: "amber" as const,
    },
    {
      label: "Payroll due now",
      value: formatCurrency(totalPayrollDue),
      change: `${approvalsPending} statement${approvalsPending === 1 ? "" : "s"} open`,
      detail: "current dues across active staff payroll",
      tone: "violet" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Payroll" />
      <StoreScopeBanner
        storeKey={activeStoreKey}
        storeName={activeStore.name}
        timeZone={activeStore.timeZone}
      />

      {dataset.source !== "database" && (
        <div className="mb-6 rounded-[24px] border border-dashed border-primary/30 bg-primary/5 px-5 py-4 text-sm text-dark-5 dark:text-dark-6">
          Supabase payroll records are required for this page. Configure the
          database connection to load payroll statements here.
        </div>
      )}

      <OperationsCompatibilityNotice
        warnings={dataset.compatibilityWarnings}
        className="mb-6"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {payrollMetrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Payroll dues by staff"
          description="Staff members with draft or scheduled pay that still needs to be processed or released."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Current Payroll</TableHead>
                <TableHead>Pay Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Total Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollDues.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                  >
                    No staff payroll dues are open right now.
                  </TableCell>
                </TableRow>
              ) : (
                payrollDues.map((due) => {
                  return (
                    <TableRow key={due.employeeId}>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {due.employeeName}
                      </TableCell>
                      <TableCell>{due.roleLabel}</TableCell>
                      <TableCell>
                        {due.periodSummary}
                        {due.statementCount > 1 ? (
                          <div className="text-xs text-dark-5 dark:text-dark-6">
                            {due.statementCount} statements
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatDate(due.payDate)}</TableCell>
                      <TableCell>
                        <StatusBadge tone={mapPayrollDueTone(due.dueStatus)}>
                          {due.dueStatus}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        {due.totalHours.toFixed(1)} hrs
                      </TableCell>
                      <TableCell className="text-right font-semibold text-dark dark:text-white">
                        {formatCurrency(due.totalDue)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
      <div className="mt-6">
        <SectionCard
          title="Recent payrolls"
          description="Management view of recent payroll statements, pay dates, status history, and inline updates"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pay Date</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                  >
                    No payroll statements are available yet.
                  </TableCell>
                </TableRow>
              ) : (
                recentRuns.map((run) => {
                  const employee = employeeMap.get(run.employee_id);
                  const totalHours = getPayrollRunHours(run);
                  const hourlyRate = Number(run.hourly_rate ?? 0);
                  const displayStatus = mapPayrollStatus(run.status);

                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        {formatDate(new Date(run.pay_date))}
                      </TableCell>
                      <TableCell className="font-medium text-dark dark:text-white">
                        {run.period_label}
                      </TableCell>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {employee?.name ?? "Employee"}
                      </TableCell>
                      <TableCell>
                        {employee?.positionTitle ?? employee?.role ?? "-"}
                      </TableCell>
                      <TableCell>
                        {hourlyRate > 0 ? formatCurrency(hourlyRate) : "-"}
                      </TableCell>
                      <TableCell>{totalHours.toFixed(1)} hrs</TableCell>
                      <TableCell>
                        {formatCurrency(Number(run.gross_pay ?? 0))}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(Number(run.deductions_total ?? 0))}
                      </TableCell>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {formatCurrency(Number(run.net_pay ?? 0))}
                      </TableCell>
                      <TableCell>
                        {formatPayrollPaymentMethod(run.payment_method)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={payrollStatusTone[displayStatus] ?? "slate"}
                        >
                          {displayStatus}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        {canManagePayrollStatements ? (
                          <div className="flex items-start gap-3">
                            <PayrollStatementEditor
                              statementId={run.id}
                              employeeName={employee?.name ?? "Employee"}
                              periodLabel={run.period_label}
                              initialGrossPay={Number(run.gross_pay ?? 0)}
                              initialBonusAmount={Number(run.bonus_amount ?? 0)}
                              initialPaymentMethod={run.payment_method}
                              initialDeductionsTotal={Number(
                                run.deductions_total ?? 0,
                              )}
                              initialDeductionRows={
                                run.pay_statement_deductions ?? []
                              }
                              allowAdjustments={canManageStatementAdjustments}
                              disabled={run.status === "archived"}
                            />
                            <PayrollStatusEditor
                              statementId={run.id}
                              initialStatus={run.status}
                            />
                            {run.status !== "archived" ? (
                              <DeletePayrollButton
                                statementId={run.id}
                                employeeName={employee?.name ?? "Employee"}
                                periodLabel={run.period_label}
                              />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-dark-5 dark:text-dark-6">
                            View only
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </>
  );
}
