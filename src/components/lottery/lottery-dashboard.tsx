"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Landmark,
  PackageCheck,
  RotateCcw,
  Search,
  Ticket,
  WalletCards,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
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
import { formatDateOnly, formatDateTime } from "@/lib/date-time";
import type {
  LotteryCashTransactionRow,
  LotteryCashTransactionType,
  LotteryDashboardSummary,
  LotteryInventorySummary,
  LotteryScratchLedgerItem,
} from "@/lib/lottery/dashboard";

type LotteryDashboardProps = {
  cashTransactions: LotteryCashTransactionRow[];
  errorMessage?: string;
  inventorySummary: LotteryInventorySummary;
  scratchLedger: LotteryScratchLedgerItem[];
  source: "database" | "error" | "unconfigured";
  summary: LotteryDashboardSummary;
  timeZone: string;
};

type ScratchLedgerSortKey =
  | "bin"
  | "game"
  | "moved"
  | "pack"
  | "received"
  | "status"
  | "tickets"
  | "value";

type ScratchLedgerSort = {
  direction: "asc" | "desc";
  key: ScratchLedgerSortKey;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return formatDateOnly(value, undefined, "Not recorded");
}

function getShortOverCopy(summary: LotteryDashboardSummary) {
  if (summary.countedDays === 0) {
    return {
      label: "Pending",
      tone: "amber" as const,
      value: "Pending",
    };
  }

  if (summary.status === "short") {
    return {
      label: "Short",
      tone: "red" as const,
      value: formatCurrency(Math.abs(summary.shortOver)),
    };
  }

  if (summary.status === "over") {
    return {
      label: "Over",
      tone: "green" as const,
      value: formatCurrency(Math.abs(summary.shortOver)),
    };
  }

  return {
    label: "Balanced",
    tone: "green" as const,
    value: formatCurrency(0),
  };
}

function getScratchStatusTone(status: LotteryScratchLedgerItem["status"]) {
  if (status === "active") {
    return "green" as const;
  }

  if (status === "backstock") {
    return "blue" as const;
  }

  if (status === "returned") {
    return "red" as const;
  }

  if (status === "sold_out") {
    return "amber" as const;
  }

  return "slate" as const;
}

function formatScratchStatus(status: LotteryScratchLedgerItem["status"]) {
  if (status === "backstock") {
    return "Backstock";
  }

  if (status === "sold_out") {
    return "Sold out";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getPackTicketCount(pack: LotteryScratchLedgerItem) {
  return pack.gameTicketCount ?? null;
}

function getPackValue(pack: LotteryScratchLedgerItem) {
  const ticketCount = getPackTicketCount(pack);

  if (!ticketCount) {
    return null;
  }

  return ticketCount * pack.ticketPrice;
}

function getMovedDate(pack: LotteryScratchLedgerItem) {
  return pack.status === "returned" ? pack.dateReturned : pack.dateActivated;
}

function getDateSortValue(value: string | null) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getScratchLedgerSortValue(
  pack: LotteryScratchLedgerItem,
  key: ScratchLedgerSortKey,
) {
  if (key === "pack") {
    return pack.packId;
  }

  if (key === "game") {
    return `${pack.gameName} ${pack.gameId}`;
  }

  if (key === "status") {
    return formatScratchStatus(pack.status);
  }

  if (key === "bin") {
    return pack.binNumber ?? 0;
  }

  if (key === "tickets") {
    return getPackTicketCount(pack) ?? 0;
  }

  if (key === "value") {
    if (pack.status === "returned" && pack.returnedValue > 0) {
      return pack.returnedValue;
    }

    return getPackValue(pack) ?? 0;
  }

  if (key === "received") {
    return getDateSortValue(pack.dateReceived);
  }

  return getDateSortValue(getMovedDate(pack));
}

function ScratchLedgerSortButton({
  activeSort,
  children,
  sortKey,
  updateSort,
}: {
  activeSort: ScratchLedgerSort;
  children: string;
  sortKey: ScratchLedgerSortKey;
  updateSort: (key: ScratchLedgerSortKey) => void;
}) {
  const isActive = activeSort.key === sortKey;
  const Icon = !isActive
    ? ArrowUpDown
    : activeSort.direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => updateSort(sortKey)}
      className={`inline-flex items-center gap-1 text-left text-xs font-semibold uppercase transition ${
        isActive ? "text-slate-950" : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

type MetricTone = "amber" | "emerald" | "red" | "sky" | "slate" | "violet";
type CashFlowFilter = "all" | "inbound" | "outbound";

const INPUT_CLASSNAME = "app-input";
const LOTTERY_CASH_TRANSACTION_TYPE_ORDER: LotteryCashTransactionType[] = [
  "EOD Cash Count",
  "Pending Expected Cash",
  "Cash Payback",
  "Cash Advance",
  "Lottery Deposit",
  "Paid EFT",
];

const metricToneClasses: Record<MetricTone, { icon: string; value: string }> = {
  amber: {
    icon: "bg-amber-50 text-amber-700 ring-amber-200",
    value: "text-amber-700",
  },
  emerald: {
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    value: "text-emerald-700",
  },
  red: {
    icon: "bg-red-50 text-red-700 ring-red-200",
    value: "text-red-700",
  },
  sky: {
    icon: "bg-sky-50 text-sky-700 ring-sky-200",
    value: "text-sky-700",
  },
  slate: {
    icon: "bg-slate-100 text-slate-700 ring-slate-200",
    value: "text-slate-950",
  },
  violet: {
    icon: "bg-violet-50 text-violet-700 ring-violet-200",
    value: "text-violet-700",
  },
};

function BreakdownRow({
  label,
  tone = "slate",
  value,
}: {
  label: string;
  tone?: MetricTone;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span
        className={`text-right text-sm font-semibold ${metricToneClasses[tone].value}`}
      >
        {value}
      </span>
    </div>
  );
}

function formatRecordedAt(value: string | null, timeZone: string) {
  if (!value) {
    return "Not recorded";
  }

  return (
    formatDateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }) || "Not recorded"
  );
}

function getTransactionTypeTone(type: LotteryCashTransactionType) {
  if (type === "EOD Cash Count" || type === "Cash Payback") {
    return "green" as const;
  }

  if (type === "Pending Expected Cash") {
    return "amber" as const;
  }

  if (type === "Cash Advance" || type === "Lottery Deposit") {
    return "red" as const;
  }

  return "blue" as const;
}

function LotteryCashTransactionLedger({
  timeZone,
  transactions,
}: {
  timeZone: string;
  transactions: LotteryCashTransactionRow[];
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<
    LotteryCashTransactionType | "all"
  >("all");
  const [flowFilter, setFlowFilter] = useState<CashFlowFilter>("all");
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const availableTypes = useMemo(
    () =>
      LOTTERY_CASH_TRANSACTION_TYPE_ORDER.filter((type) =>
        transactions.some((transaction) => transaction.type === type),
      ),
    [transactions],
  );
  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) => {
        const recordedAtLabel = formatRecordedAt(
          transaction.recordedAt,
          timeZone,
        );
        const matchesType =
          typeFilter === "all" || transaction.type === typeFilter;
        const matchesFlow =
          flowFilter === "all" ||
          (flowFilter === "inbound"
            ? transaction.amount >= 0
            : transaction.amount < 0);
        const matchesSearch =
          deferredSearch.length === 0 ||
          formatDate(transaction.businessDate)
            .toLowerCase()
            .includes(deferredSearch) ||
          transaction.businessDate.toLowerCase().includes(deferredSearch) ||
          transaction.type.toLowerCase().includes(deferredSearch) ||
          transaction.details.toLowerCase().includes(deferredSearch) ||
          recordedAtLabel.toLowerCase().includes(deferredSearch) ||
          formatCurrency(Math.abs(transaction.amount))
            .toLowerCase()
            .includes(deferredSearch) ||
          formatCurrency(transaction.balanceAfter)
            .toLowerCase()
            .includes(deferredSearch);

        return matchesType && matchesFlow && matchesSearch;
      }),
    [deferredSearch, flowFilter, timeZone, transactions, typeFilter],
  );
  const hasActiveFilters =
    searchTerm.length > 0 || typeFilter !== "all" || flowFilter !== "all";
  const inflowTotal = transactions.reduce(
    (total, transaction) =>
      transaction.amount > 0 ? total + transaction.amount : total,
    0,
  );
  const outflowTotal = transactions.reduce(
    (total, transaction) =>
      transaction.amount < 0 ? total + Math.abs(transaction.amount) : total,
    0,
  );
  const latestBalance = transactions[0]?.balanceAfter ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Current ledger balance
          </p>
          <p
            className={`mt-2 text-2xl font-black ${
              latestBalance >= 0 ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {formatCurrency(latestBalance)}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Inflows
          </p>
          <p className="mt-2 text-2xl font-black text-emerald-700">
            {formatCurrency(inflowTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Outflows
          </p>
          <p className="mt-2 text-2xl font-black text-red-700">
            {formatCurrency(outflowTotal)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_220px_220px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-dark-5 dark:text-dark-6" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className={`${INPUT_CLASSNAME} pl-10`}
            placeholder="Search date, type, details, recorded time, or amount"
          />
        </label>

        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value as LotteryCashTransactionType | "all")
          }
          className={INPUT_CLASSNAME}
        >
          <option value="all">All types</option>
          {availableTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <select
          value={flowFilter}
          onChange={(event) =>
            setFlowFilter(event.target.value as CashFlowFilter)
          }
          className={INPUT_CLASSNAME}
        >
          <option value="all">All movement</option>
          <option value="inbound">Inflows only</option>
          <option value="outbound">Outflows only</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setSearchTerm("");
            setTypeFilter("all");
            setFlowFilter("all");
          }}
          disabled={!hasActiveFilters}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-stroke bg-gray-2 px-4 py-2 text-sm font-medium text-dark transition hover:bg-stroke disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-3 dark:bg-dark-3 dark:text-white dark:hover:bg-dark-4"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
      </div>

      <div className="text-sm text-dark-5 dark:text-dark-6">
        Showing {filteredTransactions.length} of {transactions.length} lottery
        cash transactions
      </div>

      <div className="overflow-x-auto">
        <Table totalRows={filteredTransactions.length}>
          <TableHeader>
            <TableRow>
              <TableHead>Business date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-dark-5 dark:text-dark-6"
                >
                  {transactions.length === 0
                    ? "No lottery cash transactions recorded yet."
                    : "No lottery cash transactions match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map((transaction) => {
                const isInbound = transaction.amount >= 0;

                return (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium text-dark dark:text-white">
                      {formatDate(transaction.businessDate)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={getTransactionTypeTone(transaction.type)}>
                        {transaction.type}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[420px] text-sm text-dark-5 dark:text-dark-6">
                        {transaction.details}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                      {formatRecordedAt(transaction.recordedAt, timeZone)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-bold ${
                          isInbound
                            ? "text-emerald-600"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {isInbound ? "+" : "-"}
                        {formatCurrency(Math.abs(transaction.amount))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                      {formatCurrency(transaction.balanceAfter)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function LotteryDashboard({
  cashTransactions,
  errorMessage,
  inventorySummary,
  scratchLedger,
  source,
  summary,
  timeZone,
}: LotteryDashboardProps) {
  const [scratchLedgerSort, setScratchLedgerSort] = useState<ScratchLedgerSort>(
    {
      direction: "desc",
      key: "received",
    },
  );
  const shortOver = getShortOverCopy(summary);
  const sweepStatusLabel =
    summary.eftPaymentStatus === "paid" ? "Paid" : "Unpaid";
  const paidEftDetail =
    summary.paidEftWeeks > 0
      ? `${formatCurrency(summary.paidEftTotal)} paid EFT applied across ${summary.paidEftWeeks} sweep${
          summary.paidEftWeeks === 1 ? "" : "s"
        }`
      : "No paid EFT sweeps applied";
  const cashBalanceDetail = `${summary.cashInHandRecordedDays} recorded day${
    summary.cashInHandRecordedDays === 1 ? "" : "s"
  }; ${formatCurrency(summary.cashInHandBeforePaidEft)} total before paid EFT; ${paidEftDetail}`;
  const recentEftDetail = `${formatDate(summary.weekStartDate)} to ${formatDate(summary.weekEndDate)}; sweep ${formatDate(summary.sweepDate)}; ${formatCurrency(summary.settledPackSales)} settled packs`;
  const currentWeekEftDetail = `${formatDate(summary.currentWeekStartDate)} to ${formatDate(summary.currentWeekEndDate)}`;
  const shortOverDetail =
    summary.countedDays > 0
      ? `${summary.countedDays}/${summary.windowDays} days counted`
      : "No EOD cash counts saved";
  const ledgerCounts = {
    active: inventorySummary.activePacks,
    backstock: inventorySummary.backstockPacks,
    returned: inventorySummary.returnedPacks,
    soldOut: inventorySummary.soldOutPacks,
    settled: inventorySummary.settledPacks,
    total: inventorySummary.totalPacks,
  };
  const sortedScratchLedger = useMemo(() => {
    return [...scratchLedger].sort((left, right) => {
      const leftValue = getScratchLedgerSortValue(left, scratchLedgerSort.key);
      const rightValue = getScratchLedgerSortValue(
        right,
        scratchLedgerSort.key,
      );
      const modifier = scratchLedgerSort.direction === "asc" ? 1 : -1;

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * modifier;
      }

      return (
        String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * modifier
      );
    });
  }, [scratchLedger, scratchLedgerSort]);

  function updateScratchLedgerSort(key: ScratchLedgerSortKey) {
    setScratchLedgerSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : {
            key,
            direction:
              key === "pack" || key === "game" || key === "status"
                ? "asc"
                : "desc",
          },
    );
  }

  return (
    <div className="space-y-5">
      {source !== "database" ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {source === "unconfigured"
            ? "Supabase is not configured. Configure the database before loading the lottery dashboard."
            : errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          detail={cashBalanceDetail}
          icon={<WalletCards className="h-5 w-5" />}
          label="Cash in hand"
          tone={summary.cashAfterEft >= 0 ? "green" : "red"}
          value={formatCurrency(summary.cashAfterEft)}
        />
        <StatCard
          change={sweepStatusLabel}
          detail={recentEftDetail}
          icon={<Banknote className="h-5 w-5" />}
          label="Recent EFT"
          tone={
            summary.eftPaymentStatus === "paid"
              ? "green"
              : summary.netEftDue > 0
                ? "red"
                : "green"
          }
          value={formatCurrency(summary.netEftDue)}
        />
        <StatCard
          change={shortOver.label}
          detail={shortOverDetail}
          icon={
            summary.status === "balanced" ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Calculator className="h-5 w-5" />
            )
          }
          label="Total Short/Over"
          tone={
            shortOver.tone === "red"
              ? "red"
              : shortOver.tone === "green"
                ? "green"
                : "amber"
          }
          value={shortOver.value}
        />
        <StatCard
          change={
            summary.currentWeekEftDue > 0
              ? "Due"
              : summary.currentWeekEftDue < 0
                ? "Credit"
                : "Zero"
          }
          detail={currentWeekEftDetail}
          icon={<CircleDollarSign className="h-5 w-5" />}
          label="Current week EFT"
          tone={summary.currentWeekEftDue > 0 ? "red" : "green"}
          value={formatCurrency(summary.currentWeekEftDue)}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Sales and cancels"
          description="Current EFT window lottery sales."
          action={
            <StatusBadge tone="blue">
              Net {formatCurrency(summary.netSales)}
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="px-4 pb-4 pt-2"
        >
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="Online sales"
              value={formatCurrency(summary.drawSales)}
            />
            <BreakdownRow
              label="Scratch sales"
              value={formatCurrency(summary.scratchSales)}
            />
            <BreakdownRow
              label="Settled pack EFT value"
              value={formatCurrency(summary.settledPackSales)}
            />
            <BreakdownRow
              label="Gross sales"
              tone="violet"
              value={formatCurrency(summary.grossSales)}
            />
            <BreakdownRow
              label="Ticket cancels"
              tone={summary.ticketCancels > 0 ? "amber" : "slate"}
              value={`-${formatCurrency(summary.ticketCancels)}`}
            />
            <BreakdownRow
              label="Net sales"
              tone="emerald"
              value={formatCurrency(summary.netSales)}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Payouts and credits"
          description="Current EFT window cash paid out and terminal credits."
          action={
            <StatusBadge tone="slate">
              Total {formatCurrency(summary.payouts)}
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="px-4 pb-4 pt-2"
        >
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="Online payouts"
              value={formatCurrency(summary.drawPayouts)}
            />
            <BreakdownRow
              label="Scratch payouts"
              value={formatCurrency(summary.scratchPayouts)}
            />
            <BreakdownRow
              label="PROMO"
              value={formatCurrency(summary.cashingBonus)}
            />
            <BreakdownRow
              label="Total payouts and credits"
              tone="sky"
              value={formatCurrency(summary.payouts)}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Commissions and EFT"
          description="Commission credits and Thursday sweep due."
          action={
            <StatusBadge tone={summary.netEftDue > 0 ? "red" : "green"}>
              {formatCurrency(summary.totalCommissions)} commission
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="px-4 pb-4 pt-2"
        >
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="EFT net ticket sales"
              value={formatCurrency(summary.netTicketSales)}
            />
            <BreakdownRow
              label={`Retailer commission (${summary.retailerCommissionRate}%)`}
              tone="emerald"
              value={formatCurrency(summary.retailerCommissionCredit)}
            />
            <BreakdownRow
              label={`Payout commission (${summary.cashingBonusRate}%)`}
              tone="emerald"
              value={formatCurrency(summary.cashingBonusCredit)}
            />
            <BreakdownRow
              label="Total commissions"
              tone="emerald"
              value={formatCurrency(summary.totalCommissions)}
            />
            <BreakdownRow
              label="PROMO deduction"
              tone="emerald"
              value={formatCurrency(summary.cashingBonus)}
            />
            <BreakdownRow
              label="Bond fee"
              tone={summary.bondingFee > 0 ? "amber" : "slate"}
              value={formatCurrency(summary.bondingFee)}
            />
            <BreakdownRow
              label="Net EFT due"
              tone={summary.netEftDue > 0 ? "red" : "emerald"}
              value={formatCurrency(summary.netEftDue)}
            />
            <BreakdownRow
              label="Total cash in hand"
              tone={summary.cashAfterEft >= 0 ? "emerald" : "red"}
              value={formatCurrency(summary.cashAfterEft)}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Lottery cash transaction ledger"
        description={`Running lottery cash flow from EOD counts, pending estimates, cash advances, paybacks, lottery deposits, and paid EFT. Recorded times are shown in ${timeZone}.`}
        action={
          <StatusBadge tone={summary.cashAfterEft >= 0 ? "green" : "red"}>
            Balance {formatCurrency(summary.cashAfterEft)}
          </StatusBadge>
        }
        className="rounded-lg sm:rounded-lg"
        headerClassName="px-4 py-3 sm:px-4"
        contentClassName="px-4 pb-4 pt-2"
      >
        <LotteryCashTransactionLedger
          timeZone={timeZone}
          transactions={cashTransactions}
        />
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          change={`${inventorySummary.totalPacks} total`}
          detail={formatCurrency(inventorySummary.activeValue)}
          icon={<Ticket className="h-5 w-5" />}
          label="Active bins"
          tone="green"
          value={inventorySummary.activePacks}
        />
        <StatCard
          detail={formatCurrency(inventorySummary.backstockValue)}
          icon={<Archive className="h-5 w-5" />}
          label="Backstock"
          tone="blue"
          value={inventorySummary.backstockPacks}
        />
        <StatCard
          detail={formatCurrency(inventorySummary.soldOutValue)}
          icon={<CircleDollarSign className="h-5 w-5" />}
          label="Sold out"
          tone="amber"
          value={inventorySummary.soldOutPacks}
        />
        <StatCard
          detail={formatCurrency(inventorySummary.settledValue)}
          icon={<PackageCheck className="h-5 w-5" />}
          label="Settled"
          tone="slate"
          value={inventorySummary.settledPacks}
        />
        <StatCard
          detail={formatCurrency(inventorySummary.returnedValue)}
          icon={<Landmark className="h-5 w-5" />}
          label="Returned"
          tone="amber"
          value={inventorySummary.returnedPacks}
        />
      </div>

      <SectionCard
        title="Scratch card ledger"
        description="All scratch card packs across backstock, active bins, sold-out packs, settled packs, and returns."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <StatusBadge tone="slate">{ledgerCounts.total} total</StatusBadge>
            <StatusBadge tone="blue">
              {ledgerCounts.backstock} backstock
            </StatusBadge>
            <StatusBadge tone="green">{ledgerCounts.active} active</StatusBadge>
            <StatusBadge tone="amber">
              {ledgerCounts.soldOut} sold out
            </StatusBadge>
            <StatusBadge tone="slate">
              {ledgerCounts.settled} settled
            </StatusBadge>
            <StatusBadge tone="red">
              {ledgerCounts.returned} returned
            </StatusBadge>
          </div>
        }
        className="rounded-lg sm:rounded-lg"
        headerClassName="px-4 py-3 sm:px-4"
        contentClassName="p-0"
      >
        {scratchLedger.length > 0 ? (
          <div className="overflow-x-auto">
            <Table totalRows={sortedScratchLedger.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="pack"
                      updateSort={updateScratchLedgerSort}
                    >
                      Pack
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="game"
                      updateSort={updateScratchLedgerSort}
                    >
                      Game
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="status"
                      updateSort={updateScratchLedgerSort}
                    >
                      Status
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="bin"
                      updateSort={updateScratchLedgerSort}
                    >
                      Bin
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="tickets"
                      updateSort={updateScratchLedgerSort}
                    >
                      Tickets
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="value"
                      updateSort={updateScratchLedgerSort}
                    >
                      Value
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="received"
                      updateSort={updateScratchLedgerSort}
                    >
                      Received
                    </ScratchLedgerSortButton>
                  </TableHead>
                  <TableHead>
                    <ScratchLedgerSortButton
                      activeSort={scratchLedgerSort}
                      sortKey="moved"
                      updateSort={updateScratchLedgerSort}
                    >
                      Moved
                    </ScratchLedgerSortButton>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedScratchLedger.map((pack) => {
                  const ticketCount = getPackTicketCount(pack);
                  const packValue = getPackValue(pack);
                  const movedDate = getMovedDate(pack);

                  return (
                    <TableRow key={pack.id}>
                      <TableCell>
                        <div className="font-mono text-sm font-semibold text-slate-950">
                          {pack.packId}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Pack {pack.packNumber}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-950">
                          {pack.gameName}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-slate-500">
                          #{pack.gameId}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={getScratchStatusTone(pack.status)}>
                          {formatScratchStatus(pack.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-800">
                        {pack.binNumber ? `Bin ${pack.binNumber}` : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-800">
                          {ticketCount ?? "-"}
                        </div>
                        {pack.receivedTicketNumber ? (
                          <div className="mt-0.5 font-mono text-xs text-slate-500">
                            Start #{pack.receivedTicketNumber}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-semibold text-slate-800">
                        {pack.status === "returned" && pack.returnedValue > 0
                          ? formatCurrency(pack.returnedValue)
                          : packValue === null
                            ? "-"
                            : formatCurrency(packValue)}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {formatDate(pack.dateReceived)}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {formatDate(movedDate)}
                        {pack.status === "returned" &&
                        pack.returnedTicketCount !== null ? (
                          <div className="mt-0.5 text-xs text-slate-500">
                            {pack.returnedTicketCount} returned
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Archive className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-950">
                No scratch card inventory
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Received packs will appear in this ledger after delivery scan is
                saved.
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
