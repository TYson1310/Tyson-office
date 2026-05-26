import type { Metadata } from "next";
import {
  Banknote,
  CircleDollarSign,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadLotteryReportingData,
  type LotteryReportDailyRow,
} from "@/lib/lottery/reporting";
import { formatDateOnly } from "@/lib/date-time";

export const metadata: Metadata = {
  title: "Lottery Reports",
};

type PageProps = {
  searchParams: Promise<{
    days?: string | string[];
  }>;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

const periodOptions = [7, 14, 30, 90];

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDate(value: string) {
  return formatDateOnly(value, undefined, value);
}

function parseDays(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed)) {
    return 14;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 90);
}

function getStatusTone(status: LotteryReportDailyRow["status"]) {
  if (status === "short") {
    return "red" as const;
  }

  if (status === "pending") {
    return "amber" as const;
  }

  return "green" as const;
}

function getShortOverLabel(value: number) {
  if (value > 0) {
    return `Short ${formatCurrency(Math.abs(value))}`;
  }

  if (value < 0) {
    return `Over ${formatCurrency(Math.abs(value))}`;
  }

  return "Balanced";
}

export default async function LotteryReportsPage({ searchParams }: PageProps) {
  const { days } = await searchParams;
  const selectedDays = parseDays(days);
  const report = await loadLotteryReportingData({ days: selectedDays });
  const shortOverTone: "green" | "red" | "slate" =
    report.summary.shortOver > 0
      ? "red"
      : report.summary.shortOver < 0
        ? "green"
        : "slate";
  const metrics = [
    {
      detail: `${formatDate(report.startDate)} to ${formatDate(report.endDate)}`,
      icon: <CircleDollarSign className="h-5 w-5" />,
      label: "Gross Sales",
      tone: "green" as const,
      value: formatCurrency(report.summary.grossSales),
    },
    {
      change: formatCurrency(report.summary.scratchSales),
      detail: "scratch sales",
      icon: <TrendingUp className="h-5 w-5" />,
      label: "Draw Sales",
      tone: "blue" as const,
      value: formatCurrency(report.summary.drawSales),
    },
    {
      change: `Returns ${formatCurrency(report.summary.scratchReturns)}`,
      detail: `cancels ${formatCurrency(report.summary.ticketCancels)}`,
      icon: <ReceiptText className="h-5 w-5" />,
      label: "Payouts",
      tone: "amber" as const,
      value: formatCurrency(report.summary.payouts),
    },
    {
      change: getShortOverLabel(report.summary.shortOver),
      detail: `${report.summary.shortDays} short / ${report.summary.overDays} over`,
      icon: <Banknote className="h-5 w-5" />,
      label: "Short/Over",
      tone: shortOverTone,
      value: formatCurrency(Math.abs(report.summary.shortOver)),
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Lottery Reports" />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {periodOptions.map((option) => {
            const active = option === report.days;

            return (
              <a
                key={option}
                href={`/lottery/reports?days=${option}`}
                className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option} days
              </a>
            );
          })}
        </div>

        <ReportDownloadButton report="lottery" params={{ days: report.days }} />
      </div>

      <div className="space-y-6">
        {report.source !== "database" ? (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {report.source === "unconfigured"
              ? "Supabase is not configured."
              : report.errorMessage}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Daily lottery closeout"
          description={`${report.summary.balancedDays} balanced, ${report.summary.pendingDays} pending`}
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={report.dailyRows.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Scratch</TableHead>
                  <TableHead className="text-right">Draw</TableHead>
                  <TableHead className="text-right">Payouts</TableHead>
                  <TableHead className="text-right">Cancels</TableHead>
                  <TableHead className="text-right">Returns</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Till</TableHead>
                  <TableHead className="text-right">Short/Over</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.dailyRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-10 text-center text-slate-500"
                    >
                      No lottery report activity found.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.dailyRows.map((row) => (
                    <TableRow key={row.reportDate}>
                      <TableCell className="font-semibold text-slate-950">
                        {formatDate(row.reportDate)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={getStatusTone(row.status)}>
                          {row.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(row.scratchSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.drawSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.payouts)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.ticketCancels)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.scratchReturns)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.expectedCash)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.posRegisterTotal)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {getShortOverLabel(row.shortOver)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Scratch game performance"
          description={`${report.gameRows.length} games with recorded movement`}
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={report.gameRows.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead className="text-right">Ticket</TableHead>
                  <TableHead className="text-right">Tickets Sold</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Packs</TableHead>
                  <TableHead className="text-right">Bins</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.gameRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-slate-500"
                    >
                      No scratch game sales found for this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.gameRows.map((row) => (
                    <TableRow key={row.gameId}>
                      <TableCell>
                        <div className="flex min-w-64 items-center gap-3">
                          {row.imageUrl ? (
                            <div
                              className="h-12 w-12 rounded-md border border-slate-200 bg-cover bg-center"
                              style={{
                                backgroundImage: `url(${row.imageUrl})`,
                              }}
                            />
                          ) : null}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-950">
                              {row.gameName}
                            </div>
                            <div className="font-mono text-xs text-slate-500">
                              #{row.gameId}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.ticketPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {row.ticketsSold}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(row.scratchSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.packCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.binCount}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
