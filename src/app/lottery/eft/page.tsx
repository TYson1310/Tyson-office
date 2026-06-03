import type { Metadata } from "next";
import {
  Banknote,
  CalendarDays,
  CircleDollarSign,
  PackageSearch,
  Percent,
  Timer,
  WalletCards,
} from "lucide-react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { StoreScopeBanner } from "@/components/erp/store-scope-banner";
import { EftPackInclusionButton } from "@/components/lottery/eft-pack-inclusion-button";
import { EftPaidStatusControl } from "@/components/lottery/eft-paid-status-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadLotteryEftData,
  type LotteryEftDailyRow,
  type LotteryEftPaymentStatus,
  type LotteryEftSoldOutPackStatus,
  type LotteryEftSweepReason,
} from "@/lib/lottery/eft";
import { formatDateOnly } from "@/lib/date-time";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Lottery EFT",
};

type PageProps = {
  searchParams: Promise<{
    sweep?: string | string[];
    weeks?: string | string[];
  }>;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

const weekOptions = [4, 8, 13, 26];

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDate(value: string) {
  return formatDateOnly(value, undefined, value);
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const dateOnlyLabel = formatDateOnly(value, undefined, "");

  if (dateOnlyLabel) {
    return dateOnlyLabel;
  }

  return value;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-";
  }

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })}%`;
}

function parseWeeks(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed)) {
    return 8;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 52);
}

function parseSweepDate(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildEftHref(weeks: number, sweepDate?: string) {
  const params = new URLSearchParams({
    weeks: String(weeks),
  });

  if (sweepDate) {
    params.set("sweep", sweepDate);
  }

  return `/lottery/eft?${params.toString()}`;
}

function getDailyStatusTone(status: LotteryEftDailyRow["status"]) {
  if (status === "due") {
    return "red" as const;
  }

  if (status === "pending") {
    return "amber" as const;
  }

  return "green" as const;
}

function getPaymentStatusTone(status: LotteryEftPaymentStatus) {
  return status === "paid" ? ("green" as const) : ("amber" as const);
}

function formatPaymentStatus(status: LotteryEftPaymentStatus) {
  return status === "paid" ? "Paid" : "Unpaid";
}

function getSweepReasonLabel(reason: LotteryEftSweepReason) {
  if (reason === "age") {
    return ">21 days";
  }

  return ">80% depleted";
}

function getSweepReasonTone(reason: LotteryEftSweepReason) {
  if (reason === "age") {
    return "amber" as const;
  }

  return "red" as const;
}

function getSoldOutPackStatusTone(status: LotteryEftSoldOutPackStatus) {
  if (status === "pending") {
    return "amber" as const;
  }

  if (status === "included-selected") {
    return "green" as const;
  }

  return "slate" as const;
}

function getSoldOutPackStatusLabel(status: LotteryEftSoldOutPackStatus) {
  if (status === "pending") {
    return "Sold out";
  }

  if (status === "included-selected") {
    return "Settled";
  }

  return "Settled elsewhere";
}

export default async function LotteryEftPage({ searchParams }: PageProps) {
  const { sweep, weeks } = await searchParams;
  const selectedWeeks = parseWeeks(weeks);
  const selectedSweepDate = parseSweepDate(sweep);
  const [eft, auth] = await Promise.all([
    loadLotteryEftData({
      sweepDate: selectedSweepDate,
      weeks: selectedWeeks,
    }),
    getCurrentUser(),
  ]);
  const canManageEftStatus = auth?.profile?.role === "admin";
  const canManageEftPacks = ["admin", "manager", "accountant"].includes(
    auth?.profile?.role ?? "",
  );
  const selectedLedgerWeek =
    eft.weeklyLedger.find((week) => week.sweepDate === eft.selectedSweepDate) ??
    null;
  const selectedWeekPaid = selectedLedgerWeek?.paymentStatus === "paid";
  const pendingSoldOutPackRows = eft.soldOutPacks.filter(
    (pack) => pack.status === "pending",
  );
  const pendingSoldOutPacks = pendingSoldOutPackRows.length;
  const paidAmountMismatches = eft.weeklyLedger.filter(
    (week) =>
      week.paymentStatus === "paid" &&
      week.paidAmount !== null &&
      Math.abs(week.paidAmount - week.netEftDue) >= 0.01,
  );
  const packsSoldOutAfterSelectedWeek = pendingSoldOutPackRows.filter(
    (pack) => pack.soldOutDate > eft.weekEndDate,
  );
  const eftExceptionCards = [
    {
      label: "Unpaid weeks",
      value: eft.weeklySummary.unpaidWeeks,
      detail: `${formatCurrency(eft.weeklySummary.unpaidNetEftDue)} unpaid net due`,
      tone:
        eft.weeklySummary.unpaidWeeks > 0
          ? ("red" as const)
          : ("green" as const),
    },
    {
      label: "Pending sold-out packs",
      value: pendingSoldOutPacks,
      detail:
        pendingSoldOutPacks > 0
          ? "settle eligible packs into the selected EFT"
          : "no packs waiting for EFT settlement",
      tone: pendingSoldOutPacks > 0 ? ("amber" as const) : ("green" as const),
    },
    {
      label: "Paid amount mismatch",
      value: paidAmountMismatches.length,
      detail:
        paidAmountMismatches.length > 0
          ? "paid amount differs from calculated net due"
          : "paid records match calculated due",
      tone:
        paidAmountMismatches.length > 0
          ? ("red" as const)
          : ("green" as const),
    },
    {
      label: "After selected week",
      value: packsSoldOutAfterSelectedWeek.length,
      detail:
        packsSoldOutAfterSelectedWeek.length > 0
          ? `sold out after ${formatDate(eft.weekEndDate)}`
          : "no future-period pack settlement risk",
      tone:
        packsSoldOutAfterSelectedWeek.length > 0
          ? ("amber" as const)
          : ("green" as const),
    },
  ];
  const metrics = [
    {
      detail: `${formatDate(eft.weekStartDate)} to ${formatDate(eft.weekEndDate)}`,
      icon: <Banknote className="h-5 w-5" />,
      label: "Net Due",
      tone: eft.summary.netEftDue > 0 ? ("red" as const) : ("green" as const),
      value: formatCurrency(eft.summary.netEftDue),
    },
    {
      detail: `${formatDate(eft.weekStartDate)} to ${formatDate(eft.weekEndDate)}`,
      icon: <CalendarDays className="h-5 w-5" />,
      label: "Thursday Sweep",
      tone: "slate" as const,
      value: formatDate(eft.selectedSweepDate),
    },
    {
      detail: `${eft.weeklySummary.unpaidWeeks} unpaid weekly sweeps`,
      icon: <WalletCards className="h-5 w-5" />,
      label: "Unpaid EFT Due",
      tone:
        eft.weeklySummary.unpaidNetEftDue > 0
          ? ("red" as const)
          : ("green" as const),
      value: formatCurrency(eft.weeklySummary.unpaidNetEftDue),
    },
    {
      detail: "selected week online and settled pack sales",
      icon: <CircleDollarSign className="h-5 w-5" />,
      label: "EFT Sales",
      tone: "blue" as const,
      value: formatCurrency(eft.summary.grossSales),
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Lottery EFT" />
      <StoreScopeBanner />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {weekOptions.map((option) => {
            const active = option === eft.weeks;

            return (
              <a
                key={option}
                href={buildEftHref(option, eft.selectedSweepDate)}
                className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option} weeks
              </a>
            );
          })}
        </div>
        {selectedLedgerWeek ? (
          <StatusBadge
            tone={getPaymentStatusTone(selectedLedgerWeek.paymentStatus)}
          >
            {formatPaymentStatus(selectedLedgerWeek.paymentStatus)}
          </StatusBadge>
        ) : null}
      </div>

      <div className="space-y-6">
        {eft.source !== "database" ? (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {eft.source === "unconfigured"
              ? "Supabase is not configured."
              : eft.errorMessage}
          </div>
        ) : null}

        {eft.source === "database" && !eft.statusLedgerAvailable ? (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Apply the latest Supabase migration to save EFT paid/unpaid status.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="EFT exception dashboard"
          description="Controls that keep weekly EFT paid status and scratch pack settlement accountable."
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {eftExceptionCards.map((card) => (
              <div
                key={card.label}
                className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {card.label}
                  </div>
                  <StatusBadge tone={card.tone}>
                    {card.tone === "green" ? "Clear" : "Review"}
                  </StatusBadge>
                </div>
                <div className="mt-3 text-2xl font-bold text-slate-950">
                  {card.value}
                </div>
                <p className="mt-2 text-sm text-slate-500">{card.detail}</p>
              </div>
            ))}
          </div>

          {paidAmountMismatches.length > 0 ||
          packsSoldOutAfterSelectedWeek.length > 0 ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {paidAmountMismatches.length > 0 ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  <div className="font-semibold">Paid amount mismatches</div>
                  <div className="mt-1">
                    {paidAmountMismatches
                      .slice(0, 3)
                      .map(
                        (week) =>
                          `${formatDate(week.sweepDate)} paid ${formatCurrency(
                            week.paidAmount ?? 0,
                          )}, expected ${formatCurrency(week.netEftDue)}`,
                      )
                      .join("; ")}
                  </div>
                </div>
              ) : null}

              {packsSoldOutAfterSelectedWeek.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="font-semibold">
                    Sold out after selected EFT week
                  </div>
                  <div className="mt-1">
                    {packsSoldOutAfterSelectedWeek
                      .slice(0, 3)
                      .map(
                        (pack) =>
                          `Pack ${pack.packNumber} sold out ${formatDate(
                            pack.soldOutDate,
                          )}`,
                      )
                      .join("; ")}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Weekly EFT ledger"
          description="Each row covers Thursday through Wednesday; the sweep is due the following Thursday."
          action={
            <StatusBadge
              tone={eft.weeklySummary.unpaidWeeks > 0 ? "amber" : "green"}
            >
              {eft.weeklySummary.unpaidWeeks} unpaid
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={eft.weeklyLedger.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>EFT Week</TableHead>
                  <TableHead>Thursday Sweep</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">EFT Sales</TableHead>
                  <TableHead className="text-right">Settled Packs</TableHead>
                  <TableHead className="text-right">
                    Total commissions
                  </TableHead>
                  <TableHead className="text-right">Net Due</TableHead>
                  <TableHead className="w-32 text-right">Paid Amount</TableHead>
                  <TableHead className="w-[9.5rem] text-right">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eft.weeklyLedger.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-10 text-center text-slate-500"
                    >
                      No weekly EFT periods found.
                    </TableCell>
                  </TableRow>
                ) : (
                  eft.weeklyLedger.map((week) => {
                    const selected = week.sweepDate === eft.selectedSweepDate;

                    return (
                      <TableRow
                        key={week.sweepDate}
                        className={selected ? "bg-slate-50/80" : undefined}
                      >
                        <TableCell>
                          <a
                            href={buildEftHref(eft.weeks, week.sweepDate)}
                            className="font-semibold text-slate-950 transition hover:text-sky-700"
                          >
                            {formatDate(week.weekStartDate)} -{" "}
                            {formatDate(week.weekEndDate)}
                          </a>
                          {selected ? (
                            <div className="mt-1 text-xs font-semibold text-sky-700">
                              Selected week
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-semibold text-slate-950">
                          {formatDate(week.sweepDate)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1.5">
                            <StatusBadge
                              tone={getPaymentStatusTone(week.paymentStatus)}
                            >
                              {formatPaymentStatus(week.paymentStatus)}
                            </StatusBadge>
                            {week.paidAt ? (
                              <span className="text-xs text-slate-500">
                                paid {formatOptionalDate(week.paidAt)}
                              </span>
                            ) : null}
                            {week.markedBy ? (
                              <span className="text-xs text-slate-500">
                                by {week.markedBy}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(week.grossSales)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(week.settledPackSales)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(week.totalCommissions)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-slate-950">
                          {formatCurrency(week.netEftDue)}
                        </TableCell>
                        <TableCell className="w-32 text-right">
                          {week.paymentStatus === "paid" ? (
                            <div className="font-semibold text-slate-950">
                              {formatCurrency(week.appliedPaidAmount)}
                              {week.paidAmount === null ? (
                                <div className="text-xs font-medium text-slate-500">
                                  calculated
                                </div>
                              ) : null}
                              {week.paidReference ? (
                                <div className="text-xs font-medium text-slate-500">
                                  ref {week.paidReference}
                                </div>
                              ) : null}
                              {week.paidNotes ? (
                                <div className="max-w-[12rem] truncate text-xs font-medium text-slate-500">
                                  {week.paidNotes}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="w-[9.5rem] whitespace-nowrap text-right">
                          <EftPaidStatusControl
                            canManage={
                              canManageEftStatus && eft.statusLedgerAvailable
                            }
                            expectedAmount={week.netEftDue}
                            paidAmount={week.paidAmount}
                            paidNotes={week.paidNotes}
                            paidReference={week.paidReference}
                            status={week.paymentStatus}
                            sweepDate={week.sweepDate}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Sold-out pack EFT ledger"
          description="Only pending sold-out packs show here. Once settled, the pack leaves this action ledger and is included in the selected EFT."
          action={
            <StatusBadge tone={pendingSoldOutPacks > 0 ? "amber" : "green"}>
              {pendingSoldOutPacks} pending settlement
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={pendingSoldOutPackRows.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Sold Out</TableHead>
                  <TableHead>Game / Pack</TableHead>
                  <TableHead>Bin</TableHead>
                  <TableHead className="text-right">Pack Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[9.5rem] text-right">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingSoldOutPackRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-slate-500"
                    >
                      No sold-out packs are waiting for EFT settlement.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingSoldOutPackRows.map((pack) => {
                    const disabledReason = selectedWeekPaid
                      ? "Mark the selected EFT week unpaid before settling packs"
                      : !pack.hasSoldOutAudit
                        ? "Sold-out audit is missing"
                        : pack.soldOutDate > eft.weekEndDate
                          ? "Pack sold out after the selected EFT week"
                          : pack.packValue === null
                            ? "Pack value is missing"
                            : undefined;

                    return (
                      <TableRow key={pack.inventoryId}>
                        <TableCell>
                          <div className="font-semibold text-slate-950">
                            {formatDate(pack.soldOutDate)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {pack.soldOutAuditType ?? "missing audit"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-slate-950">
                            {pack.gameId} - {pack.gameName}
                          </div>
                          <div className="text-xs text-slate-500">
                            Pack {pack.packNumber}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold text-slate-950">
                          {pack.binNumber ? `Bin ${pack.binNumber}` : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-semibold text-slate-950">
                            {pack.packValue === null
                              ? "-"
                              : formatCurrency(pack.packValue)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatCurrency(pack.ticketPrice)} x{" "}
                            {pack.ticketCount ?? "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            tone={getSoldOutPackStatusTone(pack.status)}
                          >
                            {getSoldOutPackStatusLabel(pack.status)}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="w-[9.5rem] text-right">
                          <EftPackInclusionButton
                            canManage={canManageEftPacks}
                            disabledReason={disabledReason}
                            inventoryId={pack.inventoryId}
                            packLabel={`Pack ${pack.packNumber}`}
                            packValue={pack.packValue}
                            sweepDate={eft.selectedSweepDate}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Thursday Sweep Predictor"
          description="Active scratch packs over 21 days in the system or more than 80% depleted by the latest audit."
          action={
            <StatusBadge
              tone={eft.thursdaySweep.packs.length > 0 ? "amber" : "green"}
            >
              {eft.thursdaySweep.packs.length} flagged
            </StatusBadge>
          }
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="p-0"
        >
          <div className="grid gap-4 border-b border-slate-200/80 p-4 sm:grid-cols-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <PackageSearch className="h-4 w-4" />
                Flagged packs
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950">
                {eft.thursdaySweep.packs.length}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                active packs matching sweep rules
              </p>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Timer className="h-4 w-4" />
                Age rule
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950">
                {eft.thursdaySweep.agedPackCount}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                active more than 21 days
              </p>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Percent className="h-4 w-4" />
                Depletion rule
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950">
                {eft.thursdaySweep.depletedPackCount}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {formatCurrency(eft.thursdaySweep.totalPackValue)} total pack
                value
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table totalRows={eft.thursdaySweep.packs.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin</TableHead>
                  <TableHead>Game / Pack</TableHead>
                  <TableHead>In System</TableHead>
                  <TableHead>Audit Depletion</TableHead>
                  <TableHead className="text-right">Pack Value</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eft.thursdaySweep.packs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-slate-500"
                    >
                      No active packs match the Thursday Sweep rules.
                    </TableCell>
                  </TableRow>
                ) : (
                  eft.thursdaySweep.packs.map((pack) => (
                    <TableRow key={pack.inventoryId}>
                      <TableCell className="font-semibold text-slate-950">
                        {pack.binNumber ? `Bin ${pack.binNumber}` : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-950">
                          {pack.gameId} - {pack.gameName}
                        </div>
                        <div className="text-xs text-slate-500">
                          Pack {pack.packNumber}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-950">
                          {pack.daysInSystem} days
                        </div>
                        <div className="text-xs text-slate-500">
                          received {formatOptionalDate(pack.dateReceived)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-950">
                          {formatPercent(pack.depletionPercent)}
                        </div>
                        <div className="text-xs text-slate-500">
                          ticket {pack.latestTicketNumber ?? "-"} of{" "}
                          {pack.ticketCount ?? "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-semibold text-slate-950">
                          {pack.packValue === null
                            ? "-"
                            : formatCurrency(pack.packValue)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatCurrency(pack.ticketPrice)} x{" "}
                          {pack.ticketCount ?? "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {pack.reasons.map((reason) => (
                            <StatusBadge
                              key={reason}
                              tone={getSweepReasonTone(reason)}
                            >
                              {getSweepReasonLabel(reason)}
                            </StatusBadge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Daily EFT due"
          description="Net due = (online sales + settled pack value - cancels) - commissions - payouts + bonding and administrative fees."
          className="rounded-lg sm:rounded-lg"
          headerClassName="px-4 py-3 sm:px-4"
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={eft.dailyRows.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">EFT Sales</TableHead>
                  <TableHead className="text-right">Settled Packs</TableHead>
                  <TableHead className="text-right">Cancels (C)</TableHead>
                  <TableHead className="text-right">Payouts (P)</TableHead>
                  <TableHead className="text-right">PROMO</TableHead>
                  <TableHead className="text-right">Commission (R)</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Net Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eft.dailyRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-10 text-center text-slate-500"
                    >
                      No lottery EFT activity found.
                    </TableCell>
                  </TableRow>
                ) : (
                  eft.dailyRows.map((row) => (
                    <TableRow key={row.reportDate}>
                      <TableCell className="font-semibold text-slate-950">
                        {formatDate(row.reportDate)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={getDailyStatusTone(row.status)}>
                          {row.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.grossSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.settledPackSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.ticketCancels)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.totalPayouts)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.promoCredits)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.totalCommissions)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(
                          row.bondingFee + row.administrativeFees,
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-950">
                        {formatCurrency(row.netEftDue)}
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
