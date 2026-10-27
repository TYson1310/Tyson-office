import Link from "next/link";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildSalesSeries,
  calculateProductMarginPercent,
  formatCurrency,
  formatDate,
  formatShortDate,
  getInventoryStatus,
  getMonthToDateFinancials,
  getOperationsDataset,
  getOutstandingInvoiceBalance,
} from "@/lib/erp/operations";
import {
  dateKeyToUtcNoonDate,
  getCurrentMonthStartIsoDateInTimeZone,
  getTodayIsoDateInTimeZone,
  toIsoDateKey,
} from "@/lib/date-time";
import {
  buildActionNotifications,
  buildApprovalQueueRows,
  calculateCashOnHand,
} from "@/lib/erp/reporting";
import { loadLotteryEftData } from "@/lib/lottery/eft";
import { loadLotteryEodReconciliationData } from "@/lib/lottery/eod-reconciliation";
import { selectPayStatementsWithFallback } from "@/lib/payroll/pay-statements";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { INVOICE_COST_INCREASE_WARNING_PERCENT } from "@/lib/vendors/invoice-processing";
import { buildProductCostReviewSummary } from "@/lib/vendors/product-cost-review";
import { SalesChartCard } from "./sales-chart-card";

type RecentPayrollRow = {
  id: string;
  employee_id: string;
  period_label: string;
  pay_date: string;
  gross_pay: number;
  net_pay: number;
  status: "draft" | "scheduled" | "paid" | "archived";
};

function dueTone(status: string) {
  if (status === "overdue" || status === "Draft") {
    return "red";
  }

  if (status === "pending" || status === "Scheduled") {
    return "amber";
  }

  return "green";
}

function payrollTone(status: RecentPayrollRow["status"]) {
  if (status === "archived") {
    return "slate";
  }

  if (status === "draft") {
    return "red";
  }

  if (status === "scheduled") {
    return "amber";
  }

  return "green";
}

function formatPayrollStatus(status: RecentPayrollRow["status"]) {
  if (status === "archived") {
    return "Archived";
  }

  if (status === "paid") {
    return "Paid";
  }

  if (status === "scheduled") {
    return "Scheduled";
  }

  return "Draft";
}

export async function AdminOpsDashboard() {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const employeeMap = new Map(
    dataset.employees.map((employee) => [employee.id, employee]),
  );
  let recentPayrolls: RecentPayrollRow[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await selectPayStatementsWithFallback<RecentPayrollRow[]>(
      async (select) =>
        supabase
          .from("pay_statements")
          .select(select)
          .eq("store_key", activeStoreKey)
          .order("pay_date", { ascending: false })
          .limit(8)
          .returns<RecentPayrollRow[]>(),
    );

    recentPayrolls = data ?? [];
  }

  const todayDateKey = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const [lotteryEft, lotteryEod] = await Promise.all([
    loadLotteryEftData({
      weeks: 8,
    }),
    loadLotteryEodReconciliationData({
      date: todayDateKey,
    }),
  ]);
  const todaySummary =
    dataset.salesSummaries.find(
      (summary) => toIsoDateKey(summary.date) === todayDateKey,
    ) ?? null;
  const todaySales = todaySummary?.grossSales ?? 0;
  const monthToDate = getMonthToDateFinancials(dataset, {
    startDate: dateKeyToUtcNoonDate(
      getCurrentMonthStartIsoDateInTimeZone(activeStore.timeZone),
    ),
    startDateKey: getCurrentMonthStartIsoDateInTimeZone(activeStore.timeZone),
    timeZone: activeStore.timeZone,
  });
  const totalSupplierDues = dataset.vendorInvoices.reduce(
    (sum, invoice) => sum + getOutstandingInvoiceBalance(invoice),
    0,
  );
  const totalPayrollDues = dataset.payrollDues.reduce(
    (sum, due) => sum + due.netPay,
    0,
  );
  const paymentDues = totalSupplierDues + totalPayrollDues;
  const cashOnHand = calculateCashOnHand(dataset);
  const kpis = [
    {
      label: "Gross margin month to date",
      value: `${monthToDate.grossMarginPercent.toFixed(1)}%`,
      change: formatCurrency(monthToDate.grossProfit),
      detail: "gross profit earned MTD",
      tone: "blue" as const,
    },
    {
      label: "Net profit month to date",
      value: formatCurrency(monthToDate.netProfit),
      change: formatCurrency(monthToDate.expenses),
      detail: "approved expenses booked MTD",
      tone: "violet" as const,
    },
    {
      label: "Cash on hand",
      value: formatCurrency(cashOnHand),
      change: formatDate(dateKeyToUtcNoonDate(todayDateKey)),
      detail: "total logged cash vault balance",
      tone: "green" as const,
    },
    {
      label: "Payment dues",
      value: formatCurrency(paymentDues),
      change: `${dataset.vendorInvoices.filter((invoice) => getOutstandingInvoiceBalance(invoice) > 0).length} open items`,
      detail: "supplier and payroll obligations",
      tone: "amber" as const,
    },
  ];

  const lowMarginProducts = dataset.products
    .map((product) => ({
      ...product,
      marginPercent: calculateProductMarginPercent(product),
      gap: product.targetMarginPercent - calculateProductMarginPercent(product),
    }))
    .filter((product) => product.gap > 0)
    .sort((left, right) => right.gap - left.gap);
  const criticalStock = dataset.products.filter(
    (product) =>
      getInventoryStatus(product) === "Critical" ||
      getInventoryStatus(product) === "Backorder",
  );
  const overdueInvoices = dataset.vendorInvoices
    .map((invoice) => ({
      ...invoice,
      balance: getOutstandingInvoiceBalance(invoice),
    }))
    .filter((invoice) => invoice.status === "overdue" && invoice.balance > 0)
    .sort((left, right) => right.balance - left.balance);
  const unreconciledCount =
    todaySummary && !todaySummary.reconciled ? todaySummary.lineCount : 0;
  const intelligenceCards = [
    {
      title: "Margin alert",
      description:
        lowMarginProducts.length > 0
          ? `${lowMarginProducts[0].name} is ${lowMarginProducts[0].gap.toFixed(1)} pts under target margin.`
          : "All tracked products are meeting their target margin.",
      detail:
        lowMarginProducts.length > 0
          ? `${lowMarginProducts[0].marginPercent.toFixed(1)}% actual vs ${lowMarginProducts[0].targetMarginPercent.toFixed(1)}% target`
          : "No active margin exceptions",
      tone: lowMarginProducts.length > 0 ? "red" : "green",
      href: "/inventory",
    },
    {
      title: "Stock pressure",
      description:
        criticalStock.length > 0
          ? `${criticalStock.length} SKUs are in critical or backorder status.`
          : "No SKUs are in critical coverage right now.",
      detail:
        criticalStock.length > 0
          ? criticalStock
              .slice(0, 2)
              .map((product) => product.name)
              .join(", ")
          : "Shelf cover looks healthy",
      tone: criticalStock.length > 0 ? "amber" : "green",
      href: "/inventory",
    },
    {
      title: "Vendor dues risk",
      description:
        overdueInvoices.length > 0
          ? `${overdueInvoices.length} supplier invoices are already overdue.`
          : "No overdue supplier invoices on the ledger.",
      detail:
        overdueInvoices.length > 0
          ? formatCurrency(
              overdueInvoices.reduce(
                (sum, invoice) => sum + invoice.balance,
                0,
              ),
            )
          : "No escalations pending",
      tone: overdueInvoices.length > 0 ? "red" : "green",
      href: "/vendors/invoices",
    },
    {
      title: "Closeout status",
      description:
        unreconciledCount > 0
          ? `${unreconciledCount} sales logs still need reconciliation today.`
          : "Today’s sales logs are reconciled or ready for review.",
      detail: `${dataset.salesReconciliations.length} reconciliations recorded`,
      tone: unreconciledCount > 0 ? "blue" : "green",
      href: "/daily-closeout",
    },
  ];

  const supplierDues = dataset.vendorInvoices
    .map((invoice) => ({
      id: invoice.id,
      supplierName: invoice.vendorName,
      reference: invoice.invoiceNumber,
      dueDate: invoice.dueDate,
      status: invoice.status,
      balance: getOutstandingInvoiceBalance(invoice),
    }))
    .filter((invoice) => invoice.balance > 0)
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())
    .slice(0, 5);
  const payrollDues = dataset.payrollDues
    .slice()
    .sort((left, right) => left.payDate.getTime() - right.payDate.getTime())
    .slice(0, 5);
  const salesSeries = buildSalesSeries(
    dataset.salesSummaries,
    activeStore.timeZone,
  );
  const notifications = buildActionNotifications(dataset);
  const approvalQueue = buildApprovalQueueRows(dataset).slice(0, 6);
  const todayDepositPosted = dataset.bankDeposits.some(
    (deposit) =>
      deposit.status !== "void" && toIsoDateKey(deposit.date) === todayDateKey,
  );
  const pendingEftSoldOutPacks = lotteryEft.soldOutPacks.filter(
    (pack) => pack.status === "pending",
  ).length;
  const scratchAuditRecorded =
    lotteryEod.source === "database" &&
    (lotteryEod.scratchSalesToDate > 0 || lotteryEod.isReconciled);
  const dailyCloseChecklist = [
    {
      label: "Sales entry",
      detail: todaySummary
        ? `${formatCurrency(todaySales)} gross sales logged`
        : "No daily sales entry for today",
      href: "/daily-closeout",
      status: todaySummary ? "Done" : "Needed",
      tone: todaySummary ? ("green" as const) : ("amber" as const),
    },
    {
      label: "Scratch audit",
      detail:
        lotteryEod.source === "database"
          ? `${formatCurrency(lotteryEod.scratchSalesToDate)} scratch sales captured`
          : lotteryEod.errorMessage ?? "Scratch audit data unavailable",
      href: "/scratch-cards/audit",
      status: scratchAuditRecorded ? "Done" : "Review",
      tone: scratchAuditRecorded ? ("green" as const) : ("amber" as const),
    },
    {
      label: "Lottery closeout",
      detail:
        lotteryEod.source === "database"
          ? `${formatCurrency(lotteryEod.terminalSales)} terminal sales entered`
          : "Lottery EOD data unavailable",
      href: "/lottery/reconciliation",
      status: lotteryEod.isReconciled ? "Done" : "Needed",
      tone: lotteryEod.isReconciled ? ("green" as const) : ("red" as const),
    },
    {
      label: "Cash deposit",
      detail: todayDepositPosted
        ? "Posted for today's business date"
        : "No posted cash deposit for today",
      href: "/admin/bank-deposits",
      status: todayDepositPosted ? "Done" : "Needed",
      tone: todayDepositPosted ? ("green" as const) : ("amber" as const),
    },
    {
      label: "EFT status",
      detail:
        lotteryEft.source === "database"
          ? `${lotteryEft.weeklySummary.unpaidWeeks} unpaid weeks, ${pendingEftSoldOutPacks} pending packs`
          : "EFT data unavailable",
      href: "/lottery/eft",
      status:
        lotteryEft.weeklySummary.unpaidWeeks === 0 &&
        pendingEftSoldOutPacks === 0
          ? "Clear"
          : "Review",
      tone:
        lotteryEft.weeklySummary.unpaidWeeks === 0 &&
        pendingEftSoldOutPacks === 0
          ? ("green" as const)
          : ("amber" as const),
    },
    {
      label: "Vendor / expense drafts",
      detail:
        approvalQueue.length === 0
          ? "No approval drafts waiting"
          : `${approvalQueue.length} approval drafts waiting`,
      href: "/admin/approvals",
      status: approvalQueue.length === 0 ? "Clear" : "Review",
      tone: approvalQueue.length === 0 ? ("green" as const) : ("amber" as const),
    },
  ];
  const productCostReview = buildProductCostReviewSummary(dataset, {
    limit: 8,
  });
  const largestCostIncrease = productCostReview.rows.reduce<
    (typeof productCostReview.rows)[number] | null
  >(
    (largest, review) =>
      !largest || review.increasePercent > largest.increasePercent
        ? review
        : largest,
    null,
  );

  return (
    <div className="space-y-6">
      {dataset.source !== "database" && (
        <div className="rounded-[24px] border border-dashed border-primary/30 bg-primary/5 px-5 py-4 text-sm text-dark-5 dark:text-dark-6">
          Supabase operations data is not available yet. Configure the database
          connection to populate this dashboard with live records.
        </div>
      )}

      <OperationsCompatibilityNotice warnings={dataset.compatibilityWarnings} />

      {/*<SectionCard
        title="Operational finance dashboard"
        description="Live commercial performance, margin risk, and outstanding dues."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/daily-closeout"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-opacity-90"
            >
              Log sales
            </Link>
            <Link
              href="/vendors/invoices"
              className="rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
            >
              Review invoices
            </Link>
          </div>
        }
      >*/}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>
      {/*</SectionCard>*/}

      <SectionCard
        title="Daily close checklist"
        description={`Closeout controls for ${formatDate(dateKeyToUtcNoonDate(todayDateKey))}.`}
        action={
          <Link
            href="/admin/store-health"
            className="rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
          >
            Store health
          </Link>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dailyCloseChecklist.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4 transition hover:border-primary hover:bg-white"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-dark dark:text-white">
                  {item.label}
                </div>
                <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-dark-5 dark:text-dark-6">
                {item.detail}
              </p>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Sales chart"
        description="Interactive daily, monthly, and yearly sales monitoring."
      >
        <SalesChartCard series={salesSeries} />
      </SectionCard>

      <SectionCard
        title="Operations intelligence"
        description="Margin alerts, closeout risks, and due exposure that need action."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {intelligenceCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="rounded-[22px] border border-stroke bg-gray-2/60 p-5 transition hover:border-primary dark:border-dark-3 dark:bg-dark-2"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-dark dark:text-white">
                  {card.title}
                </h3>
                <StatusBadge
                  tone={card.tone as "green" | "amber" | "red" | "blue"}
                >
                  {card.tone === "green"
                    ? "Stable"
                    : card.tone === "blue"
                      ? "Review"
                      : card.tone === "amber"
                        ? "Watch"
                        : "Alert"}
                </StatusBadge>
              </div>
              <p className="mt-3 text-sm leading-6 text-dark-5 dark:text-dark-6">
                {card.description}
              </p>
              <div className="mt-4 text-sm font-semibold text-dark dark:text-white">
                {card.detail}
              </div>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Product Cost Review"
        description={`Flags ${INVOICE_COST_INCREASE_WARNING_PERCENT}%+ same-vendor cost increases and cross-vendor cost gaps from saved invoice receipts.`}
        action={
          <Link
            href="/vendors/invoices"
            className="rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
          >
            Review invoices
          </Link>
        }
      >
        <div className="grid gap-4 border-b border-stroke pb-4 dark:border-dark-3 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-dark-5 dark:text-dark-6">
              Products compared
            </div>
            <div className="mt-1 text-xl font-semibold text-dark dark:text-white">
              {productCostReview.comparedProductCount}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-dark-5 dark:text-dark-6">
              Cost alerts
            </div>
            <div className="text-amber mt-1 text-xl font-semibold">
              {productCostReview.increaseCount}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-dark-5 dark:text-dark-6">
              Largest increase
            </div>
            <div className="mt-1 text-xl font-semibold text-dark dark:text-white">
              {largestCostIncrease
                ? `${largestCostIncrease.increasePercent.toFixed(1)}%`
                : "None"}
            </div>
          </div>
        </div>

        <div className="mt-4">
          {productCostReview.rows.length > 0 ? (
            <Table totalRows={productCostReview.rows.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Comparison</TableHead>
                  <TableHead>Latest receipt</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="text-right">Increase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productCostReview.rows.map((review) => (
                  <TableRow key={review.reviewKey}>
                    <TableCell>
                      <div className="font-semibold text-dark dark:text-white">
                        {review.productName}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {review.productSku}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          review.comparisonType === "same-vendor"
                            ? "amber"
                            : "blue"
                        }
                      >
                        {review.comparisonType === "same-vendor"
                          ? "Same vendor"
                          : "Vendor gap"}
                      </StatusBadge>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {review.comparisonType === "same-vendor"
                          ? (review.latestSupplierName ?? "Vendor")
                          : `${review.previousSupplierName ?? "Lower vendor"} vs ${
                              review.latestSupplierName ?? "Higher vendor"
                            }`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {review.latestReceiptReference ?? "Saved receipt"}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {formatDate(review.latestReceiptDate)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(review.previousCost)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                      {formatCurrency(review.latestCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge tone="amber">
                        +{review.increasePercent.toFixed(1)}%
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-[20px] border border-dashed border-stroke px-5 py-8 text-center text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No product cost alerts found from saved receipt history.
              Products need saved vendor invoice receipts from the same vendor
              or multiple vendors before they can be compared.
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Notifications"
        description="Overdue vendor exposure and approval work that need attention."
      >
        {notifications.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-stroke px-5 py-10 text-center text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
            No finance notifications are active right now.
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <Link
                key={notification.id}
                href={notification.href}
                className="flex items-start justify-between gap-4 rounded-[20px] border border-stroke bg-gray-2/50 px-4 py-4 transition hover:border-primary dark:border-dark-3 dark:bg-dark-2"
              >
                <div>
                  <div className="font-semibold text-dark dark:text-white">
                    {notification.title}
                  </div>
                  <div className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {notification.detail}
                  </div>
                </div>
                <StatusBadge tone={notification.tone}>Review</StatusBadge>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Approval queue"
        description="Draft supplier adjustments and draft expenses waiting to be approved."
        action={
          <Link
            href="/admin/approvals"
            className="rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
          >
            Open queue
          </Link>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approvalQueue.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-10 text-center text-dark-5 dark:text-dark-6"
                >
                  No draft approvals are waiting right now.
                </TableCell>
              </TableRow>
            ) : (
              approvalQueue.map((item) => (
                <TableRow key={`${item.category}-${item.id}`}>
                  <TableCell>
                    <StatusBadge
                      tone={item.category === "expense" ? "blue" : "amber"}
                    >
                      {item.category === "expense" ? "Expense" : "Supplier"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-dark dark:text-white">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      {item.description}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(item.entryDate)}</TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(item.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>

      <SectionCard
        title="Supplier dues list"
        description="Open vendor balances sorted by the nearest due date."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplierDues.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-dark-5 dark:text-dark-6"
                >
                  No supplier dues are open.
                </TableCell>
              </TableRow>
            ) : (
              supplierDues.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-semibold text-dark dark:text-white">
                    {item.supplierName}
                  </TableCell>
                  <TableCell>{item.reference}</TableCell>
                  <TableCell>{formatDate(item.dueDate)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={dueTone(item.status)}>
                      {item.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(item.balance)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>

      <SectionCard
        title="Payroll dues list"
        description="Upcoming payroll obligations pulled from active pay statements."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Pay date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payrollDues.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-dark-5 dark:text-dark-6"
                >
                  No payroll dues are scheduled.
                </TableCell>
              </TableRow>
            ) : (
              payrollDues.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-semibold text-dark dark:text-white">
                    {item.employeeName}
                  </TableCell>
                  <TableCell>{item.periodLabel}</TableCell>
                  <TableCell>{formatDate(item.payDate)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={dueTone(item.status)}>
                      {item.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(item.netPay)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>

      <SectionCard
        title="Recent payrolls"
        description="Latest payroll statements across processed and scheduled payroll history."
        action={
          <Link
            href="/payroll"
            className="rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
          >
            View all payrolls
          </Link>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pay date</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentPayrolls.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-dark-5 dark:text-dark-6"
                >
                  No recent payroll statements are available yet.
                </TableCell>
              </TableRow>
            ) : (
              recentPayrolls.map((statement) => (
                <TableRow key={statement.id}>
                  <TableCell>
                    {formatDate(new Date(statement.pay_date))}
                  </TableCell>
                  <TableCell className="font-medium text-dark dark:text-white">
                    {statement.period_label}
                  </TableCell>
                  <TableCell className="font-semibold text-dark dark:text-white">
                    {employeeMap.get(statement.employee_id)?.name ?? "Employee"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={payrollTone(statement.status)}>
                      {formatPayrollStatus(statement.status)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(Number(statement.gross_pay ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(Number(statement.net_pay ?? 0))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  );
}
