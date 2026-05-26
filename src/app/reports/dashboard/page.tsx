import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import {
  dateKeyToUtcNoonDate,
  getCurrentMonthStartIsoDateInTimeZone,
} from "@/lib/date-time";
import {
  formatCurrency,
  getMonthToDateFinancials,
  getOperationsDataset,
} from "@/lib/erp/operations";
import {
  buildExecutiveAlerts,
  buildPaymentBreakdown,
  buildTopProductRows,
} from "@/lib/erp/reporting";
import { requireActiveStoreContext } from "@/lib/stores/server";

export default async function ReportsDashboard() {
  const { activeStore } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const financials = getMonthToDateFinancials(dataset, {
    startDate: dateKeyToUtcNoonDate(
      getCurrentMonthStartIsoDateInTimeZone(activeStore.timeZone),
    ),
    startDateKey: getCurrentMonthStartIsoDateInTimeZone(activeStore.timeZone),
    timeZone: activeStore.timeZone,
  });
  const paymentBreakdown = buildPaymentBreakdown(dataset);
  const topProducts = buildTopProductRows(dataset);
  const alerts = buildExecutiveAlerts(dataset);
  const totalTransactions = dataset.salesSummaries.reduce(
    (sum, summary) => sum + summary.lineCount,
    0,
  );
  const averageTicket =
    totalTransactions === 0
      ? 0
      : dataset.salesSummaries.reduce(
          (sum, summary) => sum + summary.grossSales,
          0,
        ) / totalTransactions;
  const metrics = [
    {
      label: "MTD Revenue",
      value: formatCurrency(financials.revenue),
      change: "Month to date",
      detail: "live recorded sales",
      tone: "green" as const,
    },
    {
      label: "Gross Profit",
      value: formatCurrency(financials.grossProfit),
      change: "After COGS",
      detail: "gross earnings this month",
      tone: "blue" as const,
    },
    {
      label: "Net Profit",
      value: formatCurrency(financials.netProfit),
      change: "After opex",
      detail: "approved expenses applied",
      tone: "violet" as const,
    },
    {
      label: "Profit Margin",
      value: `${financials.netMarginPercent.toFixed(1)}%`,
      change: `${totalTransactions} logged entries`,
      detail: `avg logged amount ${formatCurrency(averageTicket)}`,
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Executive Dashboard" />

      <div className="mb-6 flex justify-end">
        <ReportDownloadButton report="dashboard" />
      </div>

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase business records are not available. This dashboard is
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

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <SectionCard
            title="Sales Overview"
            description="Current operational performance from recorded sales activity."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  This Month Revenue
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(financials.revenue)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Total Logged Entries
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {totalTransactions}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Average Logged Amount
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(averageTicket)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Top Payment Method
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {paymentBreakdown[0]?.method ?? "No data"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Pending Payroll
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(
                    dataset.payrollDues.reduce(
                      (sum, due) => sum + due.netPay,
                      0,
                    ),
                  )}
                </span>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Quick Stats"
            description="Current counts from Supabase-backed operational data."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Active Vendors
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {
                    dataset.suppliers.filter(
                      (supplier) => supplier.status === "active",
                    ).length
                  }
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Products
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {dataset.products.length}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Employees
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {dataset.employees.length}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Outstanding A/P
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(
                    dataset.vendorInvoices.reduce(
                      (sum, invoice) =>
                        sum + (invoice.amount - invoice.paidAmount),
                      0,
                    ),
                  )}
                </span>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr_1fr]">
          <SectionCard
            title="Profitability"
            description="Month-to-date profit breakdown."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Revenue
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(financials.revenue)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  COGS
                </span>
                <span className="font-semibold text-red">
                  {formatCurrency(financials.cogs)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Operating Expenses
                </span>
                <span className="text-amber font-semibold">
                  {formatCurrency(financials.expenses)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Net Profit
                </span>
                <span className="font-semibold text-green">
                  {formatCurrency(financials.netProfit)}
                </span>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Top Products"
            description="Best-selling items by units sold."
          >
            <div className="space-y-3">
              {topProducts.length === 0 ? (
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  No product sales have been recorded yet.
                </p>
              ) : (
                topProducts.map((product, index) => (
                  <div
                    key={`${product.sku}-${index}`}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-dark dark:text-white">
                        {product.name}
                      </div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {product.sku}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-dark dark:text-white">
                        {product.units} units
                      </div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {formatCurrency(product.revenue)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Important Alerts"
            description="Current issues surfaced from live operational data."
          >
            <div className="space-y-2 text-sm text-dark-5 dark:text-dark-6">
              {alerts.length === 0 ? (
                <p>No current operational alerts.</p>
              ) : (
                alerts.map((alert) => <p key={alert}>• {alert}</p>)
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
