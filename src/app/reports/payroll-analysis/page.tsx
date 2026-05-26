import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, getOperationsDataset } from "@/lib/erp/operations";
import {
  getPayrollAnalysisRowsForStore,
  type PayrollAnalysisPeriodRow,
} from "@/lib/payroll/reporting";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function PayrollAnalysisPage() {
  const { activeStoreKey } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  let payrollData: PayrollAnalysisPeriodRow[] = [];

  if (isSupabaseConfigured()) {
    payrollData = await getPayrollAnalysisRowsForStore(activeStoreKey);
  }

  const totalGrossPay = payrollData.reduce((sum, row) => sum + row.grossPay, 0);
  const totalDeductions = payrollData.reduce(
    (sum, row) => sum + row.deductions,
    0,
  );
  const totalNetPay = payrollData.reduce((sum, row) => sum + row.netPay, 0);
  const averagePerEmployee =
    dataset.employees.length === 0
      ? 0
      : totalGrossPay / dataset.employees.length;
  const deductionRate =
    totalGrossPay === 0 ? 0 : (totalDeductions / totalGrossPay) * 100;
  const metrics = [
    {
      label: "Total Payroll",
      value: formatCurrency(totalGrossPay),
      change: "Gross",
      detail: "aggregated across periods",
      tone: "blue" as const,
    },
    {
      label: "Avg Per Employee",
      value: formatCurrency(averagePerEmployee),
      change: `${dataset.employees.length} staff`,
      detail: "current workforce average",
      tone: "green" as const,
    },
    {
      label: "Total Net Pay",
      value: formatCurrency(totalNetPay),
      change: "After deductions",
      detail: "take-home payroll total",
      tone: "violet" as const,
    },
    {
      label: "Deduction Rate",
      value: `${deductionRate.toFixed(1)}%`,
      change: "Withholdings",
      detail: formatCurrency(totalDeductions),
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Payroll Analysis" />

      <div className="mb-6 flex justify-end">
        <ReportDownloadButton report="payroll-analysis" />
      </div>

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase payroll statements are not available. This page is showing
            an empty live state.
          </div>
        )}

        <OperationsCompatibilityNotice
          warnings={dataset.compatibilityWarnings}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Payroll Trends"
          description="Aggregated payroll statements grouped by pay period."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Gross Pay</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollData.map((period) => (
                <TableRow key={period.period}>
                  <TableCell className="font-medium text-dark dark:text-white">
                      {period.period}
                  </TableCell>
                  <TableCell className="text-right">{period.employees}</TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(period.grossPay)}
                  </TableCell>
                  <TableCell className="text-right text-red">
                      {formatCurrency(period.deductions)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-green">
                      {formatCurrency(period.netPay)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </>
  );
}
