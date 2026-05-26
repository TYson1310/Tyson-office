import Link from "next/link";
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
  buildExpenseCategoryRows,
  buildMonthlyFinancialHistory,
} from "@/lib/erp/reporting";

export default async function ProfitAnalysisPage() {
  const dataset = await getOperationsDataset();
  const currentMonthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const periods = buildMonthlyFinancialHistory(dataset);
  const expenseCategories = buildExpenseCategoryRows(dataset, {
    start: currentMonthStart,
  });
  const draftExpenseTotal = dataset.expenses
    .filter((expense) => expense.status === "draft")
    .reduce((sum, expense) => sum + expense.amount, 0);
  const latest = periods[periods.length - 1];
  const averageMargin =
    periods.length === 0
      ? 0
      : periods.reduce((sum, period) => sum + period.margin, 0) /
        periods.length;
  const bestPeriod = [...periods].sort(
    (left, right) => right.margin - left.margin,
  )[0];
  const ytdProfit = periods.reduce((sum, period) => sum + period.profit, 0);
  const metrics = [
    {
      label: "Average Profit Margin",
      value: `${averageMargin.toFixed(1)}%`,
      change: "Across periods",
      detail: "historic blended margin",
      tone: "blue" as const,
    },
    {
      label: "Best Period",
      value: bestPeriod?.label ?? "No data",
      change: "Peak month",
      detail: bestPeriod
        ? `${bestPeriod.margin.toFixed(1)}% margin`
        : "no period data",
      tone: "green" as const,
    },
    {
      label: "Tracked Profit",
      value: formatCurrency(ytdProfit),
      change: "Year to date",
      detail: "net profit across tracked periods",
      tone: "violet" as const,
    },
    {
      label: "Latest Period",
      value: latest?.label ?? "No data",
      change: "Most recent",
      detail: latest ? formatCurrency(latest.profit) : "no period data",
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Profit Analysis" />

      <div className="mb-6 flex justify-end gap-3">
        <Link
          href="/admin/expenses"
          className="inline-flex items-center rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
        >
          Manage expenses
        </Link>
        <ReportDownloadButton report="profit" />
      </div>

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase order and expense data is not available. This page is
            showing an empty live state.
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
          title="Profitability Trends"
          description="Revenue, cost of goods, approved operating expenses, and profit by month."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Operating Exp</TableHead>
                <TableHead className="text-right">Net Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <TableRow key={period.label}>
                  <TableCell className="font-medium text-dark dark:text-white">
                      {period.label}
                  </TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(period.revenue)}
                  </TableCell>
                  <TableCell className="text-right text-red">
                      {formatCurrency(period.cogs)}
                  </TableCell>
                  <TableCell className="text-right text-amber">
                      {formatCurrency(period.opex)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-green">
                      {formatCurrency(period.profit)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-primary">
                      {period.margin.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <SectionCard
            title="Expense Breakdown"
            description="Current-month approved expenses by category."
          >
            <div className="space-y-4">
              {expenseCategories.length === 0 ? (
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  No approved operating expenses have been posted this month.
                </p>
              ) : (
                expenseCategories.map((category) => (
                  <div key={category.category}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-dark dark:text-white">
                        {category.category}
                      </span>
                      <span className="text-dark-5 dark:text-dark-6">
                        {category.entries} entries ·{" "}
                        {formatCurrency(category.total)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-dark-3">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.min(category.share, 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Approval Notes"
            description="Expense approval status and its reporting effect."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Draft expenses
                </span>
                <span className="text-amber font-semibold">
                  {formatCurrency(draftExpenseTotal)}
                </span>
              </div>
              <div className="rounded-[18px] bg-gray-1 px-4 py-3 text-sm text-dark-5 dark:bg-dark-2 dark:text-dark-6">
                Draft expenses stay out of net profit until they are approved in
                General Expenses.
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
