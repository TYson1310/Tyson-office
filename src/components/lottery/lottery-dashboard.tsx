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
  Ticket,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { formatDateOnly } from "@/lib/date-time";
import type {
  LotteryDashboardSummary,
  LotteryInventorySummary,
  LotteryScratchLedgerItem,
} from "@/lib/lottery/dashboard";

type LotteryDashboardProps = {
  errorMessage?: string;
  inventorySummary: LotteryInventorySummary;
  scratchLedger: LotteryScratchLedgerItem[];
  source: "database" | "error" | "unconfigured";
  summary: LotteryDashboardSummary;
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

function getShortOverCopy({
  countedDays,
  shortOver,
  status,
}: {
  countedDays: number;
  shortOver: number;
  status: LotteryDashboardSummary["status"];
}) {
  if (countedDays === 0) {
    return {
      label: "Pending",
      tone: "amber" as const,
      value: "Pending",
    };
  }

  if (status === "short") {
    return {
      label: "Short",
      tone: "red" as const,
      value: formatCurrency(Math.abs(shortOver)),
    };
  }

  if (status === "over") {
    return {
      label: "Over",
      tone: "green" as const,
      value: formatCurrency(Math.abs(shortOver)),
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

export function LotteryDashboard({
  errorMessage,
  inventorySummary,
  scratchLedger,
  source,
  summary,
}: LotteryDashboardProps) {
  const [scratchLedgerSort, setScratchLedgerSort] = useState<ScratchLedgerSort>(
    {
      direction: "desc",
      key: "received",
    },
  );
  const monthToDate = summary.monthToDate;
  const monthToDateLabel = `${formatDate(monthToDate.startDate)} to ${formatDate(monthToDate.endDate)}`;
  const shortOver = getShortOverCopy(monthToDate);
  const sweepStatusLabel =
    summary.eftPaymentStatus === "paid" ? "Paid" : "Unpaid";
  const recentEftDetail = `${formatDate(summary.weekStartDate)} to ${formatDate(summary.weekEndDate)}; sweep ${formatDate(summary.sweepDate)}; ${formatCurrency(summary.settledPackSales)} settled packs`;
  const currentWeekEftDetail = `${formatDate(summary.currentWeekStartDate)} to ${formatDate(summary.currentWeekEndDate)}`;
  const shortOverDetail =
    monthToDate.countedDays > 0
      ? `${monthToDate.countedDays}/${monthToDate.windowDays} MTD days counted`
      : "No MTD EOD cash counts saved";
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
            monthToDate.status === "balanced" ? (
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
          change={`Net ${formatCurrency(monthToDate.netSales)}`}
          detail={`${formatCurrency(monthToDate.drawSales)} online + ${formatCurrency(monthToDate.scratchSales)} scratch MTD`}
          icon={<Ticket className="h-5 w-5" />}
          label="Gross sales"
          tone="blue"
          value={formatCurrency(monthToDate.grossSales)}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Sales and cancels"
          description={`Month-to-date lottery sales from ${monthToDateLabel}.`}
          action={
            <StatusBadge tone="blue">
              Net {formatCurrency(monthToDate.netSales)}
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="px-4 pb-4 pt-2"
        >
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="Online sales"
              value={formatCurrency(monthToDate.drawSales)}
            />
            <BreakdownRow
              label="Scratch sales"
              value={formatCurrency(monthToDate.scratchSales)}
            />
            <BreakdownRow
              label="Settled pack EFT value"
              value={formatCurrency(monthToDate.settledPackSales)}
            />
            <BreakdownRow
              label="Gross sales"
              tone="violet"
              value={formatCurrency(monthToDate.grossSales)}
            />
            <BreakdownRow
              label="Ticket cancels"
              tone={monthToDate.ticketCancels > 0 ? "amber" : "slate"}
              value={`-${formatCurrency(monthToDate.ticketCancels)}`}
            />
            <BreakdownRow
              label="Net sales"
              tone="emerald"
              value={formatCurrency(monthToDate.netSales)}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Payouts and credits"
          description="Month-to-date prize payouts, cancels, PROMO, and EFT credits."
          action={
            <StatusBadge tone="slate">
              Credits {formatCurrency(monthToDate.totalCredits)}
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="px-4 pb-4 pt-2"
        >
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="Online payouts"
              value={formatCurrency(monthToDate.drawPayouts)}
            />
            <BreakdownRow
              label="Scratch payouts"
              value={formatCurrency(monthToDate.scratchPayouts)}
            />
            <BreakdownRow
              label="PROMO"
              value={formatCurrency(monthToDate.cashingBonus)}
            />
            <BreakdownRow
              label="Ticket cancels credit"
              tone={monthToDate.ticketCancels > 0 ? "amber" : "slate"}
              value={formatCurrency(monthToDate.ticketCancels)}
            />
            <BreakdownRow
              label="Total prize payouts"
              tone="sky"
              value={formatCurrency(monthToDate.totalPayouts)}
            />
            <BreakdownRow
              label="Total EFT credits"
              tone="sky"
              value={formatCurrency(monthToDate.totalCredits)}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Commissions"
          description="Month-to-date commission credits."
          action={
            <StatusBadge tone="green">
              {formatCurrency(monthToDate.totalCommissions)} commission
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="px-4 pb-4 pt-2"
        >
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="EFT net ticket sales"
              value={formatCurrency(monthToDate.netTicketSales)}
            />
            <BreakdownRow
              label={`Retailer commission (${summary.retailerCommissionRate}%)`}
              tone="emerald"
              value={formatCurrency(monthToDate.retailerCommissionCredit)}
            />
            <BreakdownRow
              label={`Payout commission (${summary.cashingBonusRate}%)`}
              tone="emerald"
              value={formatCurrency(monthToDate.cashingBonusCredit)}
            />
            <BreakdownRow
              label="Total commissions"
              tone="emerald"
              value={formatCurrency(monthToDate.totalCommissions)}
            />
          </div>
        </SectionCard>
      </div>

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
