import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  ClipboardCheck,
  DollarSign,
  ShieldAlert,
  Ticket,
  Wallet,
} from "lucide-react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OwnerReportingMonthSelector } from "@/components/dashboard/owner-reporting-month-selector";
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
import { listAuditEventsForActiveStore } from "@/lib/audit/events";
import {
  formatDateOnly,
  formatDateTime,
  getTodayIsoDateInTimeZone,
  toIsoDateKey,
} from "@/lib/date-time";
import {
  getInventoryStatus,
  getOperationsDataset,
  getOutstandingInvoiceBalance,
} from "@/lib/erp/operations";
import {
  buildApprovalQueueRows,
  calculateCashOnHand,
} from "@/lib/erp/reporting";
import { loadLotteryEftData } from "@/lib/lottery/eft";
import { getLatestLotteryEftSweepDate } from "@/lib/lottery/eft-periods";
import {
  filterRowsThroughOwnerReportingPeriod,
  filterRowsToOwnerReportingPeriod,
  getOwnerReportingPeriod,
  resolveOwnerReportingMonth,
} from "@/lib/owner-command-center";
import { requireActiveStoreContext } from "@/lib/stores/server";

export const metadata: Metadata = {
  title: "Owner Command Center",
};

type Tone = "green" | "amber" | "red" | "blue" | "slate" | "violet";

type OwnerAttention = {
  amount?: number;
  date?: Date;
  detail: string;
  href?: string;
  severity: "High" | "Review" | "Info";
  title: string;
};

type ChecklistItem = {
  detail: string;
  label: string;
  tone: Tone;
  value: string;
};

type PageProps = {
  searchParams: Promise<{
    month?: string | string[];
  }>;
};

const NET_SALE_KEY = "net_sale";
const TAX_KEY = "tax";
const CARD_CHARGE_KEY = "card_charge";
const OTHER_FEES_KEY = "other_fees";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function toDateKey(value: Date) {
  return toIsoDateKey(value) ?? value.toISOString().slice(0, 10);
}

function formatDateKey(value: string) {
  return formatDateOnly(value, undefined, value);
}

function formatOptionalDate(value: Date | undefined, timeZone: string) {
  if (!value) {
    return "Current";
  }

  return formatDateTime(value, {
    day: "numeric",
    month: "short",
    timeZone,
    year: "numeric",
  });
}

function getBreakdownAmount(
  breakdown: Record<string, number> | undefined,
  key: string,
) {
  return breakdown?.[key] ?? 0;
}

function getNetSale(summary: {
  grossSales: number;
  productBreakdown: Record<string, number>;
}) {
  return (
    getBreakdownAmount(summary.productBreakdown, NET_SALE_KEY) ||
    summary.grossSales
  );
}

function attentionTone(severity: OwnerAttention["severity"]): Tone {
  if (severity === "High") {
    return "red";
  }

  if (severity === "Review") {
    return "amber";
  }

  return "blue";
}

function checklistTextTone(tone: Tone) {
  if (tone === "green") {
    return "text-emerald-700";
  }

  if (tone === "red") {
    return "text-red";
  }

  if (tone === "amber") {
    return "text-amber-700";
  }

  return "text-primary";
}

export default async function OwnerCommandCenterPage({
  searchParams,
}: PageProps) {
  const { activeStore } = await requireActiveStoreContext();
  const timeZone = activeStore.timeZone;
  const todayDateKey = getTodayIsoDateInTimeZone(timeZone);
  const currentMonthKey = todayDateKey.slice(0, 7);
  const { month } = await searchParams;
  const selectedMonthKey = resolveOwnerReportingMonth(month, todayDateKey);
  const reportingPeriod = getOwnerReportingPeriod(selectedMonthKey);
  const selectedMonthLabel = formatDateOnly(
    reportingPeriod.startDateKey,
    { month: "long", year: "numeric" },
    selectedMonthKey,
  );
  const moneyPositionAsOfDateKey =
    selectedMonthKey === currentMonthKey
      ? todayDateKey
      : reportingPeriod.endDateKey;
  const cashPositionPeriod = {
    ...reportingPeriod,
    endDateKey: moneyPositionAsOfDateKey,
  };
  const eftLedgerEndSweepDate = getLatestLotteryEftSweepDate(
    reportingPeriod.endDateKey,
  );
  const [dataset, auditLedger, lotteryEft] = await Promise.all([
    getOperationsDataset(),
    listAuditEventsForActiveStore(200),
    loadLotteryEftData({
      ledgerEndSweepDate: eftLedgerEndSweepDate,
      sweepDate: eftLedgerEndSweepDate,
      weeks: 6,
    }),
  ]);
  const postedBankDeposits = dataset.bankDeposits.filter(
    (deposit) => deposit.status !== "void",
  );
  const monthSalesSummaries = filterRowsToOwnerReportingPeriod(
    dataset.salesSummaries,
    (summary) => summary.date,
    reportingPeriod,
  );
  const monthReconciliations = filterRowsToOwnerReportingPeriod(
    dataset.salesReconciliations,
    (reconciliation) => reconciliation.date,
    reportingPeriod,
  );
  const monthBankDeposits = filterRowsToOwnerReportingPeriod(
    postedBankDeposits,
    (deposit) => deposit.date,
    reportingPeriod,
  );
  const monthNetSales = monthSalesSummaries.reduce(
    (sum, summary) => sum + getNetSale(summary),
    0,
  );
  const monthTax = monthSalesSummaries.reduce(
    (sum, summary) =>
      sum + getBreakdownAmount(summary.productBreakdown, TAX_KEY),
    0,
  );
  const monthFees = monthSalesSummaries.reduce(
    (sum, summary) =>
      sum +
      getBreakdownAmount(summary.productBreakdown, CARD_CHARGE_KEY) +
      getBreakdownAmount(summary.productBreakdown, OTHER_FEES_KEY),
    0,
  );
  const monthCashSales = monthSalesSummaries.reduce(
    (sum, summary) => sum + summary.cashSales,
    0,
  );
  const monthDeposits = monthBankDeposits.reduce(
    (sum, deposit) => sum + deposit.amount,
    0,
  );
  const monthCashGap = monthCashSales - monthDeposits;
  const monthVariance = monthReconciliations.reduce(
    (sum, reconciliation) => sum + reconciliation.variance,
    0,
  );
  const cashOnHand = calculateCashOnHand({
    ...dataset,
    bankDeposits: filterRowsThroughOwnerReportingPeriod(
      dataset.bankDeposits,
      (deposit) => deposit.date,
      cashPositionPeriod,
    ),
    cashPayrollPayments: filterRowsThroughOwnerReportingPeriod(
      dataset.cashPayrollPayments,
      (payment) => payment.payDate,
      cashPositionPeriod,
    ),
    cashVaultTransactions: filterRowsThroughOwnerReportingPeriod(
      dataset.cashVaultTransactions,
      (transaction) => transaction.businessDate,
      cashPositionPeriod,
    ),
    expenses: filterRowsThroughOwnerReportingPeriod(
      dataset.expenses,
      (expense) => expense.date,
      cashPositionPeriod,
    ),
    salesReconciliations: filterRowsThroughOwnerReportingPeriod(
      dataset.salesReconciliations,
      (reconciliation) => reconciliation.date,
      cashPositionPeriod,
    ),
    salesSummaries: filterRowsThroughOwnerReportingPeriod(
      dataset.salesSummaries,
      (summary) => summary.date,
      cashPositionPeriod,
    ),
    vendorPayments: filterRowsThroughOwnerReportingPeriod(
      dataset.vendorPayments,
      (payment) => payment.paymentDate,
      cashPositionPeriod,
    ),
  });
  const approvalQueue = filterRowsToOwnerReportingPeriod(
    buildApprovalQueueRows(dataset),
    (item) => item.entryDate,
    reportingPeriod,
  );
  const openVendorInvoices = filterRowsToOwnerReportingPeriod(
    dataset.vendorInvoices
      .map((invoice) => ({
        ...invoice,
        openBalance: getOutstandingInvoiceBalance(invoice),
      }))
      .filter((invoice) => invoice.openBalance > 0)
      .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime()),
    (invoice) => invoice.dueDate,
    reportingPeriod,
  );
  const overdueInvoices = openVendorInvoices.filter(
    (invoice) => invoice.status === "overdue",
  );
  const vendorDue = openVendorInvoices.reduce(
    (sum, invoice) => sum + invoice.openBalance,
    0,
  );
  const monthPayrollDues = filterRowsToOwnerReportingPeriod(
    dataset.payrollDues,
    (due) => due.payDate,
    reportingPeriod,
  );
  const payrollDue = monthPayrollDues.reduce((sum, due) => sum + due.netPay, 0);
  const monthEftWeeks = filterRowsToOwnerReportingPeriod(
    lotteryEft.weeklyLedger,
    (week) => week.sweepDate,
    reportingPeriod,
  );
  const unpaidEftWeeks = monthEftWeeks.filter(
    (week) => week.paymentStatus === "unpaid",
  );
  const unpaidEftDue = unpaidEftWeeks.reduce(
    (sum, week) => sum + week.netEftDue,
    0,
  );
  const monthEftDue = monthEftWeeks.reduce(
    (sum, week) => sum + week.netEftDue,
    0,
  );
  const totalMoneyDue = vendorDue + payrollDue + Math.max(unpaidEftDue, 0);
  const lowStockProducts = dataset.products.filter(
    (product) => getInventoryStatus(product) !== "Healthy",
  );
  const criticalStockCount = lowStockProducts.filter(
    (product) => getInventoryStatus(product) === "Critical",
  ).length;
  const unreconciledSales = monthSalesSummaries
    .filter((summary) => !summary.reconciled)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
  const varianceRows = monthReconciliations
    .filter((reconciliation) => Math.abs(reconciliation.variance) >= 1)
    .sort((left, right) => Math.abs(right.variance) - Math.abs(left.variance));
  const salesAuditEvents = filterRowsToOwnerReportingPeriod(
    auditLedger.events.filter((event) =>
      ["sales.updated", "sales.reversed"].includes(event.action),
    ),
    (event) => event.createdAt,
    reportingPeriod,
  );
  const reportExportEvents = filterRowsToOwnerReportingPeriod(
    auditLedger.events.filter((event) => event.action === "reports.exported"),
    (event) => event.createdAt,
    reportingPeriod,
  );
  const attentionItems: OwnerAttention[] = [];

  if (monthSalesSummaries.length === 0) {
    attentionItems.push({
      detail: `No daily sales summaries were recorded for ${selectedMonthLabel}.`,
      href: "/sales/daily-entry",
      severity: "High",
      title: "Monthly sales missing",
    });
  }

  if (Math.abs(monthCashGap) >= 1) {
    attentionItems.push({
      amount: monthCashGap,
      detail: `Cash sales ${formatCurrency(monthCashSales)} vs deposits ${formatCurrency(monthDeposits)} in ${selectedMonthLabel}.`,
      href: "/admin/bank-deposits",
      severity: Math.abs(monthCashGap) >= 100 ? "High" : "Review",
      title: "Monthly cash deposit gap",
    });
  }

  if (unpaidEftDue > 0) {
    attentionItems.push({
      amount: unpaidEftDue,
      detail: `${unpaidEftWeeks.length} lottery EFT sweep${
        unpaidEftWeeks.length === 1 ? "" : "s"
      } unpaid.`,
      href: "/lottery/eft",
      severity: "Review",
      title: "Lottery EFT unpaid",
    });
  }

  overdueInvoices.slice(0, 5).forEach((invoice) => {
    attentionItems.push({
      amount: invoice.openBalance,
      date: invoice.dueDate,
      detail: `${invoice.vendorName} invoice ${invoice.invoiceNumber} is overdue.`,
      href: "/vendors/invoices",
      severity: "High",
      title: "Vendor invoice overdue",
    });
  });

  approvalQueue.slice(0, 5).forEach((item) => {
    attentionItems.push({
      amount: item.amount,
      date: item.entryDate,
      detail: item.description,
      href: item.href,
      severity: "Review",
      title: `Approval waiting: ${item.title}`,
    });
  });

  unreconciledSales.slice(0, 4).forEach((summary) => {
    attentionItems.push({
      amount: summary.cashSales,
      date: summary.date,
      detail: `${summary.lineCount} sales lines remain unreconciled.`,
      href: `/sales/daily-entry?date=${toDateKey(summary.date)}`,
      severity: "Review",
      title: "Sales day unreconciled",
    });
  });

  varianceRows.slice(0, 4).forEach((row) => {
    attentionItems.push({
      amount: row.variance,
      date: row.date,
      detail: `Expected ${formatCurrency(row.totalExpected)} vs counted ${formatCurrency(row.totalActual)}.`,
      href: "/admin/loss-prevention",
      severity: Math.abs(row.variance) >= 100 ? "High" : "Review",
      title: "Cash variance needs review",
    });
  });

  lowStockProducts.slice(0, 5).forEach((product) => {
    attentionItems.push({
      detail: `${product.name} has ${formatNumber(product.quantity)} on hand; reorder level is ${formatNumber(product.reorderLevel)}.`,
      href: "/inventory",
      severity: getInventoryStatus(product) === "Critical" ? "High" : "Review",
      title: "Inventory below target",
    });
  });

  salesAuditEvents.slice(0, 3).forEach((event) => {
    attentionItems.push({
      date: event.createdAt,
      detail: `${event.summary} by ${event.actorName ?? "User"}.`,
      href: "/admin/audit-logs",
      severity: "Review",
      title: "Sales log changed",
    });
  });

  reportExportEvents.slice(0, 2).forEach((event) => {
    attentionItems.push({
      date: event.createdAt,
      detail: `${event.summary} by ${event.actorName ?? "User"}.`,
      href: "/admin/audit-logs",
      severity: "Info",
      title: "Report exported",
    });
  });

  const sortedAttentionItems = attentionItems
    .sort((left, right) => {
      const severityRank = { High: 3, Review: 2, Info: 1 };
      const severityDifference =
        severityRank[right.severity] - severityRank[left.severity];

      if (severityDifference !== 0) {
        return severityDifference;
      }

      return (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0);
    })
    .slice(0, 15);

  const checklist: ChecklistItem[] = [
    {
      detail:
        monthSalesSummaries.length > 0
          ? `${formatCurrency(monthNetSales)} net sale across ${monthSalesSummaries.length} day${monthSalesSummaries.length === 1 ? "" : "s"}.`
          : `No sales activity was recorded for ${selectedMonthLabel}.`,
      label: "Sales activity",
      tone: monthSalesSummaries.length > 0 ? "green" : "red",
      value: `${monthSalesSummaries.length} day${monthSalesSummaries.length === 1 ? "" : "s"}`,
    },
    {
      detail:
        monthSalesSummaries.length === 0
          ? "No sales days are available to reconcile."
          : unreconciledSales.length === 0
            ? "Every recorded sales day is reconciled."
            : `${unreconciledSales.length} sales day${unreconciledSales.length === 1 ? " is" : "s are"} still open.`,
      label: "Reconciliation",
      tone:
        monthSalesSummaries.length === 0
          ? "amber"
          : unreconciledSales.length === 0
            ? "green"
            : "amber",
      value:
        monthSalesSummaries.length === 0
          ? "No sales"
          : unreconciledSales.length === 0
            ? "Closed"
            : `${unreconciledSales.length} open`,
    },
    {
      detail:
        Math.abs(monthCashGap) < 1
          ? "Cash sales match posted deposits for the month."
          : `${formatCurrency(monthCashGap)} difference against monthly deposits.`,
      label: "Deposit match",
      tone: Math.abs(monthCashGap) < 1 ? "green" : "red",
      value: Math.abs(monthCashGap) < 1 ? "Matched" : "Gap",
    },
    {
      detail:
        lotteryEft.source === "database"
          ? `${formatCurrency(monthEftDue)} net EFT across ${monthEftWeeks.length} sweep${monthEftWeeks.length === 1 ? "" : "s"}.`
          : "Lottery EFT data is unavailable.",
      label: "Lottery EFT",
      tone:
        lotteryEft.source === "database"
          ? unpaidEftDue > 0
            ? "amber"
            : "green"
          : "red",
      value: lotteryEft.source === "database" ? "Loaded" : "Missing",
    },
    {
      detail:
        approvalQueue.length === 0
          ? "No draft expenses or supplier deductions are waiting."
          : `${approvalQueue.length} item${approvalQueue.length === 1 ? "" : "s"} waiting for approval.`,
      label: "Approvals",
      tone: approvalQueue.length === 0 ? "green" : "amber",
      value: approvalQueue.length === 0 ? "Clear" : "Review",
    },
    {
      detail:
        lowStockProducts.length === 0
          ? "No tracked product is below reorder level."
          : `${lowStockProducts.length} product${lowStockProducts.length === 1 ? "" : "s"} below target.`,
      label: "Inventory",
      tone:
        criticalStockCount > 0
          ? "red"
          : lowStockProducts.length > 0
            ? "amber"
            : "green",
      value: lowStockProducts.length === 0 ? "Healthy" : "Reorder",
    },
  ];

  const moneyRows = [
    {
      amount: Math.max(monthEftDue, 0),
      detail:
        lotteryEft.source === "database"
          ? `${monthEftWeeks.length} sweep${monthEftWeeks.length === 1 ? "" : "s"} due in ${selectedMonthLabel}`
          : "Lottery EFT data unavailable",
      href: "/lottery/eft",
      label: "Monthly EFT",
      tone:
        lotteryEft.source !== "database"
          ? ("red" as const)
          : monthEftDue > 0
            ? ("amber" as const)
            : ("green" as const),
    },
    {
      amount: unpaidEftDue,
      detail:
        lotteryEft.source === "database"
          ? `${unpaidEftWeeks.length} unpaid sweep${
              unpaidEftWeeks.length === 1 ? "" : "s"
            }`
          : "Lottery EFT data unavailable",
      href: "/lottery/eft",
      label: "Unpaid EFT",
      tone:
        lotteryEft.source !== "database" || unpaidEftDue > 0
          ? ("red" as const)
          : ("green" as const),
    },
    {
      amount: vendorDue,
      detail: `${openVendorInvoices.length} open vendor invoice${
        openVendorInvoices.length === 1 ? "" : "s"
      }`,
      href: "/vendors/invoices",
      label: "Vendor bills due",
      tone:
        overdueInvoices.length > 0
          ? ("red" as const)
          : vendorDue > 0
            ? ("amber" as const)
            : ("green" as const),
    },
    {
      amount: payrollDue,
      detail: `${monthPayrollDues.length} payroll statement${
        monthPayrollDues.length === 1 ? "" : "s"
      } open`,
      href: "/payroll",
      label: "Payroll due",
      tone: payrollDue > 0 ? ("amber" as const) : ("green" as const),
    },
    {
      amount: monthCashGap,
      detail: "Selected-month cash sales less posted deposits",
      href: "/admin/bank-deposits",
      label: "Cash gap",
      tone: Math.abs(monthCashGap) >= 1 ? ("red" as const) : ("green" as const),
    },
  ];

  const metrics = [
    {
      change: selectedMonthLabel,
      detail: `${formatCurrency(monthTax)} tax; ${formatCurrency(monthFees)} fees`,
      icon: <DollarSign className="h-5 w-5" />,
      label: "Month Net Sale",
      tone:
        monthSalesSummaries.length > 0
          ? ("green" as const)
          : ("amber" as const),
      value: formatCurrency(monthNetSales),
    },
    {
      change: `${formatCurrency(monthDeposits)} deposited`,
      detail: `${formatCurrency(monthCashSales)} cash sales`,
      icon: <Banknote className="h-5 w-5" />,
      label: "Month Cash Gap",
      tone:
        Math.abs(monthCashGap) >= 100
          ? ("red" as const)
          : Math.abs(monthCashGap) >= 1
            ? ("amber" as const)
            : ("green" as const),
      value: formatCurrency(monthCashGap),
    },
    {
      change: `${formatCurrency(unpaidEftDue)} unpaid`,
      detail: `${monthEftWeeks.length} selected-month sweep${monthEftWeeks.length === 1 ? "" : "s"}`,
      icon: <Ticket className="h-5 w-5" />,
      label: "Month Lottery EFT",
      tone:
        lotteryEft.source !== "database"
          ? ("red" as const)
          : unpaidEftDue > 0
            ? ("amber" as const)
            : ("green" as const),
      value: formatCurrency(monthEftDue),
    },
    {
      change: `${monthSalesSummaries.length} sales day${
        monthSalesSummaries.length === 1 ? "" : "s"
      }`,
      detail: "days still needing drawer closeout",
      icon: <ShieldAlert className="h-5 w-5" />,
      label: "Unreconciled Days",
      tone:
        unreconciledSales.length > 0 ? ("amber" as const) : ("green" as const),
      value: unreconciledSales.length,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Owner Command Center" />

      <div className="space-y-6">
        {dataset.source !== "database" ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase operational records are not available. Owner reporting
            needs live store data.
          </div>
        ) : null}

        <OperationsCompatibilityNotice
          warnings={[
            ...dataset.compatibilityWarnings,
            ...(auditLedger.warning ? [auditLedger.warning] : []),
            ...(lotteryEft.source === "error" && lotteryEft.errorMessage
              ? [lotteryEft.errorMessage]
              : []),
          ]}
        />

        <OwnerReportingMonthSelector
          currentMonth={currentMonthKey}
          selectedMonth={selectedMonthKey}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard
            title="Monthly Owner Checklist"
            description={`${activeStore.name} controls for ${selectedMonthLabel}. Store timezone: ${timeZone}.`}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {checklist.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-dark-3 dark:bg-dark-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-dark dark:text-white">
                      {item.label}
                    </div>
                    <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
                  </div>
                  <p className={`mt-2 text-sm ${checklistTextTone(item.tone)}`}>
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Money Position"
            description={`${selectedMonthLabel} cash, deposits, bills by due date, payroll by pay date, and EFT by sweep date.`}
          >
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase text-dark-5 dark:text-dark-6">
                      Net sale · {selectedMonthLabel}
                    </div>
                    <div className="mt-1 text-xl font-bold text-dark dark:text-white">
                      {formatCurrency(monthNetSales)}
                    </div>
                  </div>
                  <Wallet className="h-8 w-8 text-primary" />
                </div>
                <div className="mt-3 grid gap-2 text-sm text-dark-5 dark:text-dark-6 sm:grid-cols-2">
                  <span>Cash sales {formatCurrency(monthCashSales)}</span>
                  <span>Deposits {formatCurrency(monthDeposits)}</span>
                  <span>
                    Cash on hand as of {formatDateKey(moneyPositionAsOfDateKey)}{" "}
                    {formatCurrency(cashOnHand)}
                  </span>
                  <span>Money due {formatCurrency(totalMoneyDue)}</span>
                </div>
              </div>

              {moneyRows.map((row) => (
                <Link
                  key={row.label}
                  href={row.href}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 transition hover:border-primary/40 hover:bg-primary/5 dark:border-dark-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-dark dark:text-white">
                      {row.label}
                    </div>
                    <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      {row.detail}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-dark dark:text-white">
                      {formatCurrency(row.amount)}
                    </div>
                    <StatusBadge tone={row.tone}>
                      {row.tone === "green" ? "OK" : "Review"}
                    </StatusBadge>
                  </div>
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Undone Reconciliation"
          description={`Every sales day still awaiting drawer closeout in ${selectedMonthLabel}.`}
          action={
            <Link href="/admin/sales-logs" className="app-secondary-button-sm">
              View Sales Logs
            </Link>
          }
        >
          {unreconciledSales.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <ClipboardCheck className="h-5 w-5" />
              No undone reconciliation was found for {selectedMonthLabel}.
            </div>
          ) : (
            <Table totalRows={unreconciledSales.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Sales Lines</TableHead>
                  <TableHead className="text-right">Net Sale</TableHead>
                  <TableHead className="text-right">Cash Sales</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unreconciledSales.map((summary) => {
                  const dateKey = toDateKey(summary.date);

                  return (
                    <TableRow key={summary.id}>
                      <TableCell>{formatDateKey(dateKey)}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(summary.lineCount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(getNetSale(summary))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(summary.cashSales)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone="amber">Open</StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/sales/daily-entry?date=${dateKey}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          Reconcile
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Monthly Snapshot"
          description={`Sales, fees, cash, deposits, reconciliation, and variance for ${selectedMonthLabel}.`}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Net Sale</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Cash Sales</TableHead>
                <TableHead className="text-right">Deposits</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{selectedMonthLabel}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(monthNetSales)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(monthTax)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(monthFees)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(monthCashSales)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(monthDeposits)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(monthVariance)}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={
                      monthSalesSummaries.length === 0
                        ? "slate"
                        : unreconciledSales.length === 0
                          ? "green"
                          : "amber"
                    }
                  >
                    {monthSalesSummaries.length === 0
                      ? "No sales"
                      : unreconciledSales.length === 0
                        ? "Reconciled"
                        : `${unreconciledSales.length} open`}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard
          title="Attention Queue"
          description={`${selectedMonthLabel} financial exceptions plus current inventory risks.`}
          action={
            <Link
              href="/admin/loss-prevention"
              className="app-secondary-button-sm"
            >
              <AlertTriangle className="h-4 w-4" />
              Loss Prevention
            </Link>
          }
        >
          {sortedAttentionItems.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <ClipboardCheck className="h-5 w-5" />
              No owner-level exceptions were found for this store.
            </div>
          ) : (
            <Table totalRows={sortedAttentionItems.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAttentionItems.map((item, index) => (
                  <TableRow key={`${item.title}-${index}`}>
                    <TableCell>
                      <StatusBadge tone={attentionTone(item.severity)}>
                        {item.severity}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="font-semibold text-dark dark:text-white">
                      {item.href ? (
                        <Link href={item.href} className="hover:text-primary">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </TableCell>
                    <TableCell>{item.detail}</TableCell>
                    <TableCell>
                      {formatOptionalDate(item.date, timeZone)}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof item.amount === "number"
                        ? formatCurrency(item.amount)
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
    </>
  );
}
