import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { getOperationsDataset, formatCurrency } from "@/lib/erp/operations";
import {
  buildPaymentBreakdown,
  buildRecentSalesTrend,
} from "@/lib/erp/reporting";

export default async function SalesAnalyticsPage() {
  const dataset = await getOperationsDataset();
  const dailyData = buildRecentSalesTrend(dataset);
  const paymentBreakdown = buildPaymentBreakdown(dataset);
  const totalSales = dailyData.reduce((sum, day) => sum + day.sales, 0);
  const totalTransactions = dailyData.reduce(
    (sum, day) => sum + day.transactions,
    0,
  );
  const averageTransaction =
    totalTransactions === 0 ? 0 : totalSales / totalTransactions;
  const topPaymentMethod = paymentBreakdown[0];
  const metrics = [
    {
      label: "7-Day Revenue",
      value: formatCurrency(totalSales),
      change: "7 days",
      detail: "recorded sales activity",
      tone: "green" as const,
    },
    {
      label: "Logged Entries",
      value: totalTransactions,
      change: "Recent logs",
      detail: "manual breakdown records across recent days",
      tone: "blue" as const,
    },
    {
      label: "Average Logged Amount",
      value: formatCurrency(averageTransaction),
      change: "Per log",
      detail: "revenue divided by recorded sales logs",
      tone: "violet" as const,
    },
    {
      label: "Top Payment Method",
      value: topPaymentMethod?.method ?? "No data",
      change: topPaymentMethod
        ? formatCurrency(topPaymentMethod.amount)
        : "No payments",
      detail: "highest payment mix contributor",
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Sales Analytics" />

      <div className="mb-6 flex justify-end">
        <ReportDownloadButton report="sales" />
      </div>

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase sales records are not available. This page is showing an
            empty live state.
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

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <SectionCard
            title="Daily Sales"
            description="Live totals from recent daily sales entries."
          >
            <div className="space-y-4">
              {dailyData.map((day) => {
                const width =
                  totalSales === 0
                    ? 0
                    : (day.sales /
                        Math.max(...dailyData.map((row) => row.sales), 1)) *
                      100;

                return (
                  <div
                    key={day.label}
                    className="grid grid-cols-[72px_1fr_88px] items-center gap-4"
                  >
                    <span className="text-sm font-medium text-dark dark:text-white">
                      {day.label}
                    </span>
                    <div className="h-8 rounded-full bg-gray-100 dark:bg-dark-3">
                      <div
                        className="flex h-8 items-center rounded-full bg-primary px-3 text-xs font-semibold text-white"
                        style={{ width: `${width}%` }}
                      >
                        {day.sales > 0 ? formatCurrency(day.sales) : ""}
                      </div>
                    </div>
                    <span className="text-right text-sm text-dark-5 dark:text-dark-6">
                      {day.transactions} logs
                    </span>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Payment Breakdown"
            description="Share of revenue by recorded payment method."
          >
            <div className="space-y-4">
              {paymentBreakdown.length === 0 ? (
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  No payment activity has been recorded in Supabase.
                </p>
              ) : (
                paymentBreakdown.map((method) => (
                  <div key={method.method}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-dark dark:text-white">
                        {method.method}
                      </span>
                      <span className="text-dark-5 dark:text-dark-6">
                        {method.percent.toFixed(1)}% ·{" "}
                        {formatCurrency(method.amount)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-dark-3">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.min(method.percent, 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
