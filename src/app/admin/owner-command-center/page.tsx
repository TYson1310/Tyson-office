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
  getCurrentMonthStartIsoDateInTimeZone,
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
    return "Today";
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

function sumByDate<T>(
  rows: T[],
  getDate: (row: T) => Date,
  getAmount: (row: T) => number,
  dateKey: string,
) {
  return rows
    .filter((row) => toDateKey(getDate(row)) === dateKey)
    .reduce((sum, row) => sum + getAmount(row), 0);
}

function sumSinceDate<T>(
  rows: T[],
  getDate: (row: T) => Date,
  getAmount: (row: T) => number,
  startDateKey: string,
) {
  return rows
    .filter((row) => toDateKey(getDate(row)) >= startDateKey)
    .reduce((sum, row) => sum + getAmount(row), 0);
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

export default async function OwnerCommandCenterPage() {
  const { activeStore } = await requireActiveStoreContext();
  const [dataset, auditLedger, lotteryEft] = await Promise.all([
    getOperationsDataset(),
    listAuditEventsForActiveStore(200),
    loadLotteryEftData({ weeks: 8 }),
  ]);
  const timeZone = activeStore.timeZone;
  const todayDateKey = getTodayIsoDateInTimeZone(timeZone);
  const monthStartDateKey = getCurrentMonthStartIsoDateInTimeZone(timeZone);
  const todaySummary =
    dataset.salesSummaries.find(
      (summary) => toDateKey(summary.date) === todayDateKey,
    ) ?? null;
  const todayReconciliation =
    dataset.salesReconciliations.find(
      (reconciliation) => toDateKey(reconciliation.date) === todayDateKey,
    ) ?? null;
  const postedBankDeposits = dataset.bankDeposits.filter(
    (deposit) => deposit.status !== "void",
  );
  const todayDeposits = sumByDate(
    postedBankDeposits,
    (deposit) => deposit.date,
    (deposit) => deposit.amount,
    todayDateKey,
  );
  const todayNetSales = todaySummary ? getNetSale(todaySummary) : 0;
  const todayTax = getBreakdownAmount(todaySummary?.productBreakdown, TAX_KEY);
  const todayCardCharge = getBreakdownAmount(
    todaySummary?.productBreakdown,
    CARD_CHARGE_KEY,
  );
  const todayOtherFees = getBreakdownAmount(
    todaySummary?.productBreakdown,
    OTHER_FEES_KEY,
  );
  const todayCashSales = todaySummary?.cashSales ?? 0;
  const todayCashGap = todayCashSales - todayDeposits;
  const todayVariance = todayReconciliation?.variance ?? 0;
  const monthNetSales = dataset.salesSummaries
    .filter((summary) => toDateKey(summary.date) >= monthStartDateKey)
    .reduce((sum, summary) => sum + getNetSale(summary), 0);
  const monthCashSales = sumSinceDate(
    dataset.salesSummaries,
    (summary) => summary.date,
    (summary) => summary.cashSales,
    monthStartDateKey,
  );
  const monthDeposits = sumSinceDate(
    postedBankDeposits,
    (deposit) => deposit.date,
    (deposit) => deposit.amount,
    monthStartDateKey,
  );
  const cashOnHand = calculateCashOnHand(dataset);
  const approvalQueue = buildApprovalQueueRows(dataset);
  const openVendorInvoices = dataset.vendorInvoices
    .map((invoice) => ({
      ...invoice,
      openBalance: getOutstandingInvoiceBalance(invoice),
    }))
    .filter((invoice) => invoice.openBalance > 0)
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());
  const overdueInvoices = openVendorInvoices.filter(
    (invoice) => invoice.status === "overdue",
  );
  const vendorDue = openVendorInvoices.reduce(
    (sum, invoice) => sum + invoice.openBalance,
    0,
  );
  const payrollDue = dataset.payrollDues.reduce(
    (sum, due) => sum + due.netPay,
    0,
  );
  const unpaidEftDue =
    lotteryEft.source === "database"
      ? lotteryEft.weeklySummary.unpaidNetEftDue
      : 0;
  const currentWeekEft =
    lotteryEft.source === "database" ? lotteryEft.summary.netEftDue : 0;
  const totalMoneyDue = vendorDue + payrollDue + Math.max(unpaidEftDue, 0);
  const lowStockProducts = dataset.products.filter(
    (product) => getInventoryStatus(product) !== "Healthy",
  );
  const criticalStockCount = lowStockProducts.filter(
    (product) => getInventoryStatus(product) === "Critical",
  ).length;
  const unreconciledSales = dataset.salesSummaries
    .filter((summary) => !summary.reconciled)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
  const varianceRows = dataset.salesReconciliations
    .filter((reconciliation) => Math.abs(reconciliation.variance) >= 1)
    .sort((left, right) => Math.abs(right.variance) - Math.abs(left.variance));
  const salesAuditEvents = auditLedger.events.filter((event) =>
    ["sales.updated", "sales.reversed"].includes(event.action),
  );
  const reportExportEvents = auditLedger.events.filter(
    (event) => event.action === "reports.exported",
  );
  const attentionItems: OwnerAttention[] = [];

  if (!todaySummary) {
    attentionItems.push({
      detail: `No daily sales summary has been recorded for ${formatDateKey(todayDateKey)}.`,
      href: "/sales/daily-entry",
      severity: "High",
      title: "Today's sales missing",
    });
  } else if (!todaySummary.reconciled) {
    attentionItems.push({
      amount: todayCashSales,
      date: todaySummary.date,
      detail: "Sales are entered but the drawer is not reconciled.",
      href: "/sales/daily-entry",
      severity: "Review",
      title: "Today's drawer open",
    });
  }

  if (Math.abs(todayCashGap) >= 1) {
    attentionItems.push({
      amount: todayCashGap,
      detail: `Cash sales ${formatCurrency(todayCashSales)} vs deposits ${formatCurrency(todayDeposits)}.`,
      href: "/admin/bank-deposits",
      severity: Math.abs(todayCashGap) >= 100 ? "High" : "Review",
      title: "Today cash deposit gap",
    });
  }

  if (Math.abs(todayVariance) >= 1) {
    attentionItems.push({
      amount: todayVariance,
      date: todayReconciliation?.date,
      detail: `Drawer variance recorded for ${formatDateKey(todayDateKey)}.`,
      href: "/sales/daily-entry",
      severity: Math.abs(todayVariance) >= 100 ? "High" : "Review",
      title: "Today drawer variance",
    });
  }

  if (unpaidEftDue > 0) {
    attentionItems.push({
      amount: unpaidEftDue,
      detail: `${lotteryEft.weeklySummary.unpaidWeeks} lottery EFT week${
        lotteryEft.weeklySummary.unpaidWeeks === 1 ? "" : "s"
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

  unreconciledSales
    .filter((summary) => toDateKey(summary.date) !== todayDateKey)
    .slice(0, 4)
    .forEach((summary) => {
      attentionItems.push({
        amount: summary.cashSales,
        date: summary.date,
        detail: `${summary.lineCount} sales lines remain unreconciled.`,
        href: "/admin/sales-logs",
        severity: "Review",
        title: "Past sales day unreconciled",
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
      detail: todaySummary
        ? `${formatCurrency(todayNetSales)} net sale recorded.`
        : "Daily net sale, tax, and fees are not entered yet.",
      label: "Sales entry",
      tone: todaySummary ? "green" : "red",
      value: todaySummary ? "Done" : "Missing",
    },
    {
      detail: todaySummary?.reconciled
        ? "Drawer reconciliation is complete."
        : "Close the drawer before relying on cash numbers.",
      label: "Reconciliation",
      tone: todaySummary?.reconciled ? "green" : "amber",
      value: todaySummary?.reconciled ? "Closed" : "Open",
    },
    {
      detail:
        Math.abs(todayCashGap) < 1
          ? "Cash sales match same-day deposits."
          : `${formatCurrency(todayCashGap)} difference against today's deposits.`,
      label: "Deposit match",
      tone: Math.abs(todayCashGap) < 1 ? "green" : "red",
      value: Math.abs(todayCashGap) < 1 ? "Matched" : "Gap",
    },
    {
      detail:
        lotteryEft.source === "database"
          ? `${formatCurrency(currentWeekEft)} current week net EFT due.`
          : "Lottery EFT data is unavailable.",
      label: "Lottery EFT",
      tone:
        lotteryEft.source === "database"
          ? currentWeekEft > 0
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
      amount: Math.max(currentWeekEft, 0),
      detail:
        lotteryEft.source === "database"
          ? `${formatDateKey(lotteryEft.weekStartDate)} to ${formatDateKey(lotteryEft.weekEndDate)}`
          : "Lottery EFT data unavailable",
      href: "/lottery/eft",
      label: "Current week EFT",
      tone: currentWeekEft > 0 ? ("amber" as const) : ("green" as const),
    },
    {
      amount: unpaidEftDue,
      detail: `${lotteryEft.weeklySummary.unpaidWeeks} unpaid sweep${
        lotteryEft.weeklySummary.unpaidWeeks === 1 ? "" : "s"
      }`,
      href: "/lottery/eft",
      label: "Unpaid EFT",
      tone: unpaidEftDue > 0 ? ("red" as const) : ("green" as const),
    },
    {
      amount: vendorDue,
      detail: `${openVendorInvoices.length} open vendor invoice${
        openVendorInvoices.length === 1 ? "" : "s"
      }`,
      href: "/vendors/invoices",
      label: "Vendor bills",
      tone: overdueInvoices.length > 0 ? ("red" as const) : ("amber" as const),
    },
    {
      amount: payrollDue,
      detail: `${dataset.payrollDues.length} payroll statement${
        dataset.payrollDues.length === 1 ? "" : "s"
      } open`,
      href: "/payroll",
      label: "Payroll due",
      tone: payrollDue > 0 ? ("amber" as const) : ("green" as const),
    },
    {
      amount: todayCashGap,
      detail: "Today cash sales less deposits",
      href: "/admin/bank-deposits",
      label: "Cash gap",
      tone: Math.abs(todayCashGap) >= 1 ? ("red" as const) : ("green" as const),
    },
  ];

  const metrics = [
    {
      change: formatDateKey(todayDateKey),
      detail: `${formatCurrency(todayTax)} tax; ${formatCurrency(
        todayCardCharge + todayOtherFees,
      )} fees`,
      icon: <DollarSign className="h-5 w-5" />,
      label: "Today Net Sale",
      tone: todaySummary ? ("green" as const) : ("amber" as const),
      value: formatCurrency(todayNetSales),
    },
    {
      change: `${formatCurrency(todayDeposits)} deposited`,
      detail: `${formatCurrency(todayCashSales)} cash sales`,
      icon: <Banknote className="h-5 w-5" />,
      label: "Today Cash Gap",
      tone:
        Math.abs(todayCashGap) >= 100
          ? ("red" as const)
          : Math.abs(todayCashGap) >= 1
            ? ("amber" as const)
            : ("green" as const),
      value: formatCurrency(todayCashGap),
    },
    {
      change: `${formatCurrency(unpaidEftDue)} unpaid`,
      detail: "current and recent lottery sweeps",
      icon: <Ticket className="h-5 w-5" />,
      label: "Lottery EFT",
      tone: unpaidEftDue > 0 ? ("amber" as const) : ("green" as const),
      value: formatCurrency(currentWeekEft),
    },
    {
      change: `${sortedAttentionItems.length} item${
        sortedAttentionItems.length === 1 ? "" : "s"
      }`,
      detail: "exceptions needing owner review",
      icon: <ShieldAlert className="h-5 w-5" />,
      label: "Attention Queue",
      tone: sortedAttentionItems.some((item) => item.severity === "High")
        ? ("red" as const)
        : sortedAttentionItems.length > 0
          ? ("amber" as const)
          : ("green" as const),
      value: sortedAttentionItems.length,
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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard
            title="Owner Checklist"
            description={`${activeStore.name} status for ${formatDateKey(
              todayDateKey,
            )}. Store timezone: ${timeZone}.`}
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
            description="Cash, deposits, bills, payroll, and EFT in one view."
          >
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase text-dark-5 dark:text-dark-6">
                      Month to date
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
                  <span>Cash on hand {formatCurrency(cashOnHand)}</span>
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
          title="Today Snapshot"
          description="Daily sales, fees, cash, deposits, reconciliation, and variance."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
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
                <TableCell>{formatDateKey(todayDateKey)}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(todayNetSales)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(todayTax)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(todayCardCharge + todayOtherFees)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(todayCashSales)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(todayDeposits)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(todayVariance)}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={todaySummary?.reconciled ? "green" : "amber"}
                  >
                    {todaySummary?.reconciled ? "Reconciled" : "Open"}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard
          title="Attention Queue"
          description="Items most likely to affect cash, profit, accountability, or operations."
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
