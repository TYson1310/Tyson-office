"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAppNotifications } from "@/contexts/NotificationContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Download,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import type { DailyReconciliation, DailySalesSummary } from "@/types/erp.types";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toDateKey(value: Date) {
  return value.toISOString().split("T")[0];
}

function matchesDateFilters(
  date: string,
  dateFrom: string,
  dateTo: string,
  searchTerm: string,
) {
  const matchesDateFrom = !dateFrom || date >= dateFrom;
  const matchesDateTo = !dateTo || date <= dateTo;
  const matchesSearch = !searchTerm || date.includes(searchTerm);

  return matchesDateFrom && matchesDateTo && matchesSearch;
}

export default function AdminSalesLogsPage() {
  const { error: notifyError } = useAppNotifications();
  const [summaries, setSummaries] = useState<DailySalesSummary[]>([]);
  const [reconciliations, setReconciliations] = useState<DailyReconciliation[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/sales?includeReconciliations=true");
      if (!response.ok) throw new Error("Failed to fetch sales logs");

      const data = (await response.json()) as {
        summaries?: any[];
        reconciliations?: any[];
      };
      const fetchedSummaries = (data.summaries ?? []).map((summary: any) => ({
        ...summary,
        date: new Date(summary.date),
        reconciledAt: summary.reconciledAt
          ? new Date(summary.reconciledAt)
          : undefined,
        createdAt: new Date(summary.createdAt),
        updatedAt: new Date(summary.updatedAt),
      }));

      const fetchedReconciliations = (data.reconciliations ?? []).map(
        (r: any) => ({
          ...r,
          date: new Date(r.date),
          reconciliedAt: new Date(r.reconciliedAt),
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        }),
      );

      setSummaries(fetchedSummaries);
      setReconciliations(fetchedReconciliations);
    } catch (err: any) {
      notifyError(
        err instanceof Error ? err.message : "Failed to fetch sales logs",
      );
    } finally {
      setIsLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const filteredSummaries = useMemo(
    () =>
      summaries.filter((summary) =>
        matchesDateFilters(
          toDateKey(summary.date),
          dateFrom,
          dateTo,
          searchTerm,
        ),
      ),
    [dateFrom, dateTo, searchTerm, summaries],
  );

  const filteredReconciliations = useMemo(
    () =>
      reconciliations.filter((reconciliation) =>
        matchesDateFilters(
          toDateKey(reconciliation.date),
          dateFrom,
          dateTo,
          searchTerm,
        ),
      ),
    [dateFrom, dateTo, reconciliations, searchTerm],
  );

  const dailyLogs = useMemo(() => {
    const logsByDate: Record<
      string,
      {
        date: string;
        totalPayments: number;
        totalCashSalesLogged: number;
        totalBankDeposit: number | null;
        payouts: number;
        variance: number;
        reconciled: boolean;
        transactionCount: number;
      }
    > = {};

    // Process transactions
    filteredSummaries.forEach((summary) => {
      const dateStr = toDateKey(summary.date);
      if (!logsByDate[dateStr]) {
        logsByDate[dateStr] = {
          date: dateStr,
          totalPayments: 0,
          totalCashSalesLogged: 0,
          totalBankDeposit: null,
          payouts: 0,
          variance: 0,
          reconciled: false,
          transactionCount: 0,
        };
      }
      logsByDate[dateStr].totalPayments = summary.grossSales;
      logsByDate[dateStr].totalCashSalesLogged = summary.cashSales;
      logsByDate[dateStr].transactionCount = summary.lineCount;
      logsByDate[dateStr].reconciled = summary.reconciled;
    });

    // Process reconciliations
    filteredReconciliations.forEach((recon) => {
      const dateStr = toDateKey(recon.date);
      if (!logsByDate[dateStr]) {
        logsByDate[dateStr] = {
          date: dateStr,
          totalPayments: 0,
          totalCashSalesLogged: 0,
          totalBankDeposit: null,
          payouts: 0,
          variance: 0,
          reconciled: true,
          transactionCount: 0,
        };
      }
      logsByDate[dateStr].totalBankDeposit =
        recon.totalActual - recon.closingFloat;
      logsByDate[dateStr].payouts = recon.totalPayouts;
      logsByDate[dateStr].variance = recon.variance;
      logsByDate[dateStr].reconciled = true;
    });

    return Object.values(logsByDate).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }, [filteredReconciliations, filteredSummaries]);

  const stats = useMemo(() => {
    const totalPayments = dailyLogs.reduce(
      (sum, log) => sum + log.totalPayments,
      0,
    );
    const totalPayouts = dailyLogs.reduce((sum, log) => sum + log.payouts, 0);
    const totalVariance = dailyLogs.reduce((sum, log) => sum + log.variance, 0);
    const reconciledDays = dailyLogs.filter((log) => log.reconciled).length;

    return {
      totalPayments,
      totalPayouts,
      totalVariance,
      reconciledDays,
      count: dailyLogs.length,
    };
  }, [dailyLogs]);

  return (
    <div className="mx-auto max-w-7xl">
      <Breadcrumb pageName="Daily Sales Logs" />

      <div className="grid grid-cols-1 gap-6">
        {/* Stats Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SectionCard title="Total Payments" className="bg-primary/5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <DollarSign className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  Gross Sales
                </p>
                <h3 className="text-xl font-bold text-dark dark:text-white">
                  {formatCurrency(stats.totalPayments)}
                </h3>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Payouts" className="bg-red/5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red/10 text-red">
                <Download className="h-6 w-6 rotate-180" />
              </div>
              <div>
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  Cash paid out
                </p>
                <h3 className="text-xl font-bold text-dark dark:text-white">
                  {formatCurrency(stats.totalPayouts)}
                </h3>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Cash Variance" className="bg-amber/5">
            <div className="flex items-center gap-4">
              <div className="bg-amber/10 text-amber flex h-12 w-12 items-center justify-center rounded-full">
                <AlertCircle className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  Short / over total
                </p>
                <h3 className="text-xl font-bold text-dark dark:text-white">
                  {formatCurrency(stats.totalVariance)}
                </h3>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Reconciliation" className="bg-green/5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green/10 text-green">
                <CheckCircle className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  Days Closed
                </p>
                <h3 className="text-xl font-bold text-dark dark:text-white">
                  {stats.reconciledDays} / {stats.count}
                </h3>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Filters */}
        <SectionCard title="Filters & Search">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" />
              <input
                type="text"
                placeholder="Search date (YYYY-MM-DD)..."
                className="w-full rounded-lg border border-stroke bg-transparent py-2 pl-10 pr-4 text-sm outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:col-span-2">
              <div className="relative min-w-0 flex-1">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" />
                <input
                  type="date"
                  className="w-full rounded-lg border border-stroke bg-transparent py-2 pl-10 pr-3 text-sm outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-dark-5 sm:text-sm sm:font-normal sm:normal-case sm:tracking-normal">
                to
              </span>
              <div className="relative min-w-0 flex-1">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-5" />
                <input
                  type="date"
                  className="w-full rounded-lg border border-stroke bg-transparent py-2 pl-10 pr-3 text-sm outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <button
              onClick={() => {
                setSearchTerm("");
                setDateFrom("");
                setDateTo("");
              }}
              className="flex items-center justify-center gap-2 rounded-lg border border-stroke bg-gray-2 px-4 py-2 text-sm font-medium text-dark transition-colors hover:bg-stroke dark:border-dark-3 dark:bg-dark-3 dark:text-white dark:hover:bg-dark-4"
            >
              Reset Filters
            </button>
          </div>
        </SectionCard>

        {/* Daily Summaries Table */}
        <SectionCard
          title="Daily Sales Logs Summary"
          description="Aggregated daily payment, payout, cash variance, and closeout status."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total Payments</TableHead>
                  <TableHead className="text-right">Payouts</TableHead>
                  <TableHead className="text-right">Cash Variance</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                        Loading daily logs...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : dailyLogs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-32 text-center text-dark-5"
                    >
                      No matching daily logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  dailyLogs.map((log) => (
                    <TableRow key={log.date}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {new Date(log.date).toLocaleDateString(undefined, {
                          weekday: "short",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </TableCell>
                      <TableCell className="text-right font-bold text-dark dark:text-white">
                        {formatCurrency(log.totalPayments)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-red">
                        {formatCurrency(log.payouts)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          log.variance > 0
                            ? "text-red"
                            : log.variance < 0
                              ? "text-green"
                              : "text-dark-5"
                        }`}
                      >
                        {log.variance > 0
                          ? `-${formatCurrency(log.variance)}`
                          : log.variance < 0
                            ? `+${formatCurrency(Math.abs(log.variance))}`
                            : formatCurrency(log.variance)}
                      </TableCell>
                      <TableCell className="text-center">
                        {log.reconciled ? (
                          <StatusBadge tone="green">Reconciled</StatusBadge>
                        ) : (
                          <StatusBadge tone="amber">Pending</StatusBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
