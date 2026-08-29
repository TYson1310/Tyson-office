import type { Metadata } from "next";
import { Camera } from "lucide-react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import {
  CashTransactionLedger,
  type CashTransactionLedgerRow,
} from "@/components/dashboard/cash-transaction-ledger";
import { CashVaultAdjustmentButton } from "@/components/dashboard/cash-vault-adjustment-button";
import { MakeDepositButton } from "@/components/dashboard/make-deposit-button";
import { VoidBankDepositButton } from "@/components/dashboard/void-bank-deposit-button";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { StoreScopeBanner } from "@/components/erp/store-scope-banner";
import { LotteryCashAdvancesPanel } from "@/components/lottery/lottery-cash-advances-panel";
import { loadFinancialAccountabilityStatus } from "@/lib/accountability/financial-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDateOnly,
  formatDateTime,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import {
  formatCurrency,
  formatDate,
  getOperationsDataset,
  type OperationsCashVaultTransaction,
} from "@/lib/erp/operations";
import { calculateCashOnHand } from "@/lib/erp/reporting";
import { loadLotteryCashAdvanceSummary } from "@/lib/lottery/cash-advances";
import {
  loadLotteryDashboardData,
  type LotteryCashTransactionRow,
} from "@/lib/lottery/dashboard";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { createClient } from "@/lib/supabase/server";
import type { CashSource } from "@/types/erp.types";

export const metadata: Metadata = {
  title: "Cash Vault & Deposits",
};

function toLedgerLabel(
  movementType: OperationsCashVaultTransaction["movementType"],
): CashTransactionLedgerRow["type"] {
  if (movementType === "cash_sale") {
    return "Cash Sale";
  }

  if (movementType === "sales_payout") {
    return "Sales Payout";
  }

  if (movementType === "cash_variance") {
    return "Cash Variance";
  }

  if (movementType === "cash_expense") {
    return "Cash Expense";
  }

  if (movementType === "vendor_payment_cash") {
    return "Vendor Payment";
  }

  if (movementType === "payroll_cash") {
    return "Cash Payroll";
  }

  if (movementType === "bank_deposit") {
    return "Bank Deposit";
  }

  if (movementType === "lottery_cash_advance_to_vault") {
    return "Lottery Cash Advance";
  }

  if (movementType === "lottery_cash_advance_payback_from_vault") {
    return "Lottery Cash Payback";
  }

  if (movementType === "opening_balance") {
    return "Opening Balance";
  }

  return "Manual Adjustment";
}

function buildCashTransactionLedgerRows(
  transactions: OperationsCashVaultTransaction[],
  timeZone: string,
): CashTransactionLedgerRow[] {
  return transactions.map((transaction) => ({
    id: transaction.id,
    businessDateLabel: formatDate(transaction.businessDate),
    type: toLedgerLabel(transaction.movementType),
    details:
      transaction.movementType === "bank_deposit"
        ? `${transaction.details} (${formatCashSource(transaction.cashSource)})`
        : transaction.details,
    amount: transaction.amount,
    recordedAtLabel: formatRecordedAt(transaction.recordedAt, timeZone),
  }));
}

function buildLotteryCashTransactionLedgerRows(
  transactions: LotteryCashTransactionRow[],
  timeZone: string,
): CashTransactionLedgerRow[] {
  return transactions.map((transaction) => ({
    id: transaction.id,
    businessDateLabel: formatDateOnly(transaction.businessDate),
    type: transaction.type,
    details: transaction.details,
    amount: transaction.amount,
    balanceAfterLabel: formatCurrency(transaction.balanceAfter),
    recordedAtLabel: transaction.recordedAt
      ? formatRecordedAt(new Date(transaction.recordedAt), timeZone)
      : "Pending",
  }));
}

function formatCashSource(source: CashSource) {
  return source === "lottery_till" ? "Lottery cash" : "Store cash";
}

function formatRecordedAt(value: Date, timeZone: string) {
  return formatDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

type LotteryCashBreakdownTone = "emerald" | "red" | "slate";

const lotteryCashBreakdownToneClassNames: Record<
  LotteryCashBreakdownTone,
  string
> = {
  emerald: "text-emerald-700",
  red: "text-red-700",
  slate: "text-slate-950",
};

function formatLotteryDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return formatDateOnly(value, undefined, "Not recorded");
}

function formatSignedCurrency(value: number) {
  if (value === 0) {
    return formatCurrency(0);
  }

  return `${value > 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function LotteryCashBreakdownRow({
  label,
  tone = "slate",
  value,
}: {
  label: string;
  tone?: LotteryCashBreakdownTone;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span
        className={`text-right text-sm font-semibold ${lotteryCashBreakdownToneClassNames[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}

function getDepositSlipHref(depositId: string) {
  return `/api/bank-deposits/slip?id=${encodeURIComponent(depositId)}`;
}

export default async function BankDepositsPage() {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const [dataset, supabase, lotteryDashboardData] = await Promise.all([
    getOperationsDataset(),
    createClient(),
    loadLotteryDashboardData(),
  ]);
  const accountabilityStatus = await loadFinancialAccountabilityStatus(
    supabase,
    activeStoreKey,
  );
  const storeSettings = await loadStoreSettingsForStore(
    supabase,
    activeStoreKey,
  );
  const timeZone = storeSettings.profile.timezone;
  const businessDate = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const lotteryCashAdvanceSummary = isSupabaseConfigured()
    ? await loadLotteryCashAdvanceSummary({
        businessDate,
        storeKey: activeStoreKey,
        supabase,
      })
    : {
        available: false,
        dailyAdvanceTotal: 0,
        dailyNetCashImpact: 0,
        dailyPaybackTotal: 0,
        openAdvanceBalance: 0,
        openAdvances: [],
        openBalance: 0,
        warning: "Supabase is not configured.",
      };
  const lotterySummary = lotteryDashboardData.summary;
  const cashOnHand = calculateCashOnHand(dataset);
  const postedBankDeposits = dataset.bankDeposits.filter(
    (deposit) => deposit.status !== "void",
  );
  const cashTransactions = buildCashTransactionLedgerRows(
    dataset.cashVaultTransactions,
    timeZone,
  );
  const lotteryCashTransactions = buildLotteryCashTransactionLedgerRows(
    lotteryDashboardData.cashTransactions,
    timeZone,
  );
  const lotteryCashIncludesToday =
    lotterySummary.cashInHandCutoffDate === businessDate;
  const lotteryCashCutoffDetail = `Through ${formatLotteryDate(
    lotterySummary.cashInHandCutoffDate,
  )}; ${lotteryCashIncludesToday ? "today included" : "today excluded"}`;
  const lotteryCashDescription = lotteryCashIncludesToday
    ? `Expected lottery cash through ${formatLotteryDate(
        lotterySummary.cashInHandCutoffDate,
      )}. Today's Lottery EOD is saved, so today is included.`
    : `Expected lottery cash through ${formatLotteryDate(
        lotterySummary.cashInHandCutoffDate,
      )}. Today's sales are excluded until Lottery EOD is saved.`;

  const metrics = [
    {
      label: "Store cash on hand",
      value: formatCurrency(cashOnHand),
      change: "Logged vault balance",
      detail: "Register cash only; lottery cash excluded",
      tone: "green" as const,
    },
    {
      label: "Lottery cash in hand",
      value: formatCurrency(lotterySummary.cashAfterEft),
      change: "Separate ledger",
      detail: lotteryCashCutoffDetail,
      tone: lotterySummary.cashAfterEft >= 0 ? ("green" as const) : ("red" as const),
    },
    {
      label: "Total deposited",
      value: formatCurrency(
        postedBankDeposits.reduce((sum, deposit) => sum + deposit.amount, 0),
      ),
      change: `${postedBankDeposits.length} posted records`,
      detail: "Voided deposits are excluded",
      tone: "blue" as const,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <Breadcrumb pageName="Cash Vault" />
      <StoreScopeBanner
        storeKey={activeStoreKey}
        storeName={activeStore.name}
        timeZone={timeZone}
      />

      <OperationsCompatibilityNotice
        warnings={[
          ...dataset.compatibilityWarnings,
          ...accountabilityStatus.warnings,
        ]}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="space-y-6">
        <SectionCard
          title="Store cash transaction ledger"
          description={`Register cash sales, sales payouts, cash variances, approved cash expenses, cash vendor payments, cash payroll, and store-cash bank deposits. Lottery cash is excluded. Recorded times are shown in ${timeZone}.`}
        >
          <CashTransactionLedger transactions={cashTransactions} />
        </SectionCard>

        <div id="lottery-cash" className="space-y-6 scroll-mt-24">
          {lotteryDashboardData.source !== "database" ? (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {lotteryDashboardData.source === "unconfigured"
                ? "Supabase is not configured. Configure the database before loading lottery cash vault data."
                : lotteryDashboardData.errorMessage}
            </div>
          ) : null}

          <SectionCard
            title="Lottery cash in hand"
            description={lotteryCashDescription}
            action={
              <StatusBadge
                tone={lotterySummary.cashAfterEft >= 0 ? "green" : "red"}
              >
                Lottery cash {formatCurrency(lotterySummary.cashAfterEft)}
              </StatusBadge>
            }
            className="rounded-lg sm:rounded-lg"
            headerClassName="px-4 py-3 sm:px-4"
            contentClassName="px-4 pb-4 pt-2"
          >
            <div className="divide-y divide-slate-100">
              <LotteryCashBreakdownRow
                label="Scratch sales total"
                value={formatCurrency(lotterySummary.cashInHandScratchSales)}
              />
              <LotteryCashBreakdownRow
                label="Online sales total"
                value={formatCurrency(lotterySummary.cashInHandOnlineSales)}
              />
              <LotteryCashBreakdownRow
                label="Payouts total"
                tone={
                  lotterySummary.cashInHandPayouts > 0 ? "red" : "slate"
                }
                value={`-${formatCurrency(lotterySummary.cashInHandPayouts)}`}
              />
              <LotteryCashBreakdownRow
                label="Cancels total"
                tone={
                  lotterySummary.cashInHandCancels > 0 ? "red" : "slate"
                }
                value={`-${formatCurrency(lotterySummary.cashInHandCancels)}`}
              />
              <LotteryCashBreakdownRow
                label="Net lottery sales"
                tone="emerald"
                value={formatCurrency(
                  lotterySummary.cashInHandNetLotterySales,
                )}
              />
              <LotteryCashBreakdownRow
                label="Paid EFT"
                tone={lotterySummary.paidEftTotal > 0 ? "red" : "slate"}
                value={`-${formatCurrency(lotterySummary.paidEftTotal)}`}
              />
              <LotteryCashBreakdownRow
                label="Cash advance"
                tone={
                  lotterySummary.cashInHandCashAdvanceImpact < 0
                    ? "red"
                    : lotterySummary.cashInHandCashAdvanceImpact > 0
                      ? "emerald"
                      : "slate"
                }
                value={formatSignedCurrency(
                  lotterySummary.cashInHandCashAdvanceImpact,
                )}
              />
              <LotteryCashBreakdownRow
                label="Lottery deposits"
                tone={
                  lotterySummary.cashInHandLotteryDepositImpact < 0
                    ? "red"
                    : lotterySummary.cashInHandLotteryDepositImpact > 0
                      ? "emerald"
                      : "slate"
                }
                value={formatSignedCurrency(
                  lotterySummary.cashInHandLotteryDepositImpact,
                )}
              />
              <LotteryCashBreakdownRow
                label="Expected by total stats"
                tone={
                  lotterySummary.cashInHandExpectedByStats >= 0
                    ? "emerald"
                    : "red"
                }
                value={formatCurrency(
                  lotterySummary.cashInHandExpectedByStats,
                )}
              />
              <LotteryCashBreakdownRow
                label="Lottery over / short"
                tone={
                  lotterySummary.cashInHandShortOverImpact < 0
                    ? "red"
                    : lotterySummary.cashInHandShortOverImpact > 0
                      ? "emerald"
                      : "slate"
                }
                value={formatSignedCurrency(
                  lotterySummary.cashInHandShortOverImpact,
                )}
              />
              <LotteryCashBreakdownRow
                label="Daily collected cash"
                tone={
                  lotterySummary.cashInHandCollectedDaily >= 0
                    ? "emerald"
                    : "red"
                }
                value={formatCurrency(
                  lotterySummary.cashInHandCollectedDaily,
                )}
              />
              <LotteryCashBreakdownRow
                label="Collected vs current logic"
                tone={
                  lotterySummary.cashInHandCollectedDailyVariance < 0
                    ? "red"
                    : lotterySummary.cashInHandCollectedDailyVariance > 0
                      ? "emerald"
                      : "slate"
                }
                value={formatSignedCurrency(
                  lotterySummary.cashInHandCollectedDailyVariance,
                )}
              />
              <LotteryCashBreakdownRow
                label="Lottery cash in hand"
                tone={lotterySummary.cashAfterEft >= 0 ? "emerald" : "red"}
                value={formatCurrency(lotterySummary.cashAfterEft)}
              />
            </div>
          </SectionCard>

          <LotteryCashAdvancesPanel
            available={lotteryCashAdvanceSummary.available}
            businessDate={businessDate}
            dailyAdvanceTotal={lotteryCashAdvanceSummary.dailyAdvanceTotal}
            dailyNetCashImpact={
              lotteryCashAdvanceSummary.dailyNetCashImpact
            }
            dailyPaybackTotal={lotteryCashAdvanceSummary.dailyPaybackTotal}
            disabled={dataset.source !== "database"}
            openAdvanceBalance={lotteryCashAdvanceSummary.openBalance}
            openAdvances={lotteryCashAdvanceSummary.openAdvances}
            warning={lotteryCashAdvanceSummary.warning}
          />

          <SectionCard
            title="Daily lottery cash transaction ledger"
            description={`Daily lottery cash movements, deposits, advances, and EFT activity. Recorded times are shown in ${timeZone}.`}
          >
            <CashTransactionLedger transactions={lotteryCashTransactions} />
          </SectionCard>

        </div>

        <SectionCard
          title="Bank deposit history"
          description={`Detailed history of all recorded cash transfers to the bank. Recorded times are shown in ${timeZone}.`}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <CashVaultAdjustmentButton
                disabled={
                  dataset.source !== "database" ||
                  !accountabilityStatus.available
                }
                timeZone={timeZone}
              />
              <MakeDepositButton
                disabled={dataset.source !== "database"}
                storeKey={activeStoreKey}
                timeZone={timeZone}
              />
            </div>
          }
        >
          <Table totalRows={dataset.bankDeposits.length}>
            <TableHeader>
              <TableRow>
                <TableHead>Deposit date</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Slip photo</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataset.bankDeposits.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-dark-5 dark:text-dark-6"
                  >
                    No bank deposits recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                dataset.bankDeposits.map((deposit) => (
                  <TableRow key={deposit.id}>
                    <TableCell className="font-medium text-dark dark:text-white">
                      {formatDate(deposit.date)}
                    </TableCell>
                    <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                      {formatRecordedAt(deposit.createdAt, timeZone)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={deposit.status === "void" ? "red" : "green"}
                      >
                        {deposit.status === "void" ? "Void" : "Posted"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          deposit.cashSource === "lottery_till"
                            ? "amber"
                            : "blue"
                        }
                      >
                        {formatCashSource(deposit.cashSource)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="font-bold text-dark dark:text-white">
                      {formatCurrency(deposit.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[300px] text-sm text-dark-5 dark:text-dark-6">
                        {deposit.notes || "-"}
                        {deposit.voidReason ? (
                          <div className="mt-1 text-xs text-red">
                            Void: {deposit.voidReason}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {deposit.slipPhotoPath ? (
                        <a
                          href={getDepositSlipHref(deposit.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          <Camera className="h-4 w-4" />
                          View slip
                        </a>
                      ) : (
                        <span className="text-dark-5">No photo</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <VoidBankDepositButton
                        depositId={deposit.id}
                        disabled={
                          dataset.source !== "database" ||
                          !accountabilityStatus.available ||
                          deposit.status === "void"
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </div>
  );
}
