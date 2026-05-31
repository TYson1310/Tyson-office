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
import { loadFinancialAccountabilityStatus } from "@/lib/accountability/financial-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/date-time";
import {
  formatCurrency,
  formatDate,
  getOperationsDataset,
  type OperationsCashVaultTransaction,
} from "@/lib/erp/operations";
import { calculateCashOnHand } from "@/lib/erp/reporting";
import { loadStoreSettingsForStore } from "@/lib/store-settings";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { createClient } from "@/lib/supabase/server";

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
    details: transaction.details,
    amount: transaction.amount,
    recordedAtLabel: formatRecordedAt(transaction.recordedAt, timeZone),
  }));
}

function formatRecordedAt(value: Date, timeZone: string) {
  return formatDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

function getDepositSlipHref(depositId: string) {
  return `/api/bank-deposits/slip?id=${encodeURIComponent(depositId)}`;
}

export default async function BankDepositsPage() {
  const { activeStoreKey } = await requireActiveStoreContext();
  const [dataset, supabase] = await Promise.all([
    getOperationsDataset(),
    createClient(),
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
  const cashOnHand = calculateCashOnHand(dataset);
  const postedBankDeposits = dataset.bankDeposits.filter(
    (deposit) => deposit.status !== "void",
  );
  const cashTransactions = buildCashTransactionLedgerRows(
    dataset.cashVaultTransactions,
    timeZone,
  );

  const metrics = [
    {
      label: "Cash on hand",
      value: formatCurrency(cashOnHand),
      change: "Logged vault balance",
      detail: "Calculated from cash movement ledger",
      tone: "green" as const,
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

      <OperationsCompatibilityNotice
        warnings={[
          ...dataset.compatibilityWarnings,
          ...accountabilityStatus.warnings,
        ]}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="space-y-6">
        <SectionCard
          title="Cash transaction ledger"
          description={`Cash sales, sales payouts, cash variances, approved cash expenses, cash vendor payments, cash payroll, and bank deposits that move the vault balance. Recorded times are shown in ${timeZone}.`}
        >
          <CashTransactionLedger transactions={cashTransactions} />
        </SectionCard>

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
                    colSpan={7}
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
