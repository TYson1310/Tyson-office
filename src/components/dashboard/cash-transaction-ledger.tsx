"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CashTransactionLedgerRow = {
  id: string;
  businessDateLabel: string;
  type:
    | "Cash Sale"
    | "Sales Payout"
    | "Cash Variance"
    | "Cash Expense"
    | "Vendor Payment"
    | "Cash Payroll"
    | "Bank Deposit"
    | "Opening Balance"
    | "Manual Adjustment";
  details: string;
  amount: number;
  recordedAtLabel: string;
};

type CashFlowFilter = "all" | "inbound" | "outbound";

const INPUT_CLASSNAME = "app-input";
const TRANSACTION_TYPE_ORDER: CashTransactionLedgerRow["type"][] = [
  "Cash Sale",
  "Sales Payout",
  "Cash Variance",
  "Cash Expense",
  "Vendor Payment",
  "Cash Payroll",
  "Bank Deposit",
  "Opening Balance",
  "Manual Adjustment",
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function CashTransactionLedger({
  transactions,
}: {
  transactions: CashTransactionLedgerRow[];
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<
    CashTransactionLedgerRow["type"] | "all"
  >("all");
  const [flowFilter, setFlowFilter] = useState<CashFlowFilter>("all");
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const availableTypes = useMemo(
    () =>
      TRANSACTION_TYPE_ORDER.filter((type) =>
        transactions.some((transaction) => transaction.type === type),
      ),
    [transactions],
  );

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) => {
        const matchesType =
          typeFilter === "all" || transaction.type === typeFilter;
        const matchesFlow =
          flowFilter === "all" ||
          (flowFilter === "inbound"
            ? transaction.amount >= 0
            : transaction.amount < 0);
        const matchesSearch =
          deferredSearch.length === 0 ||
          transaction.businessDateLabel
            .toLowerCase()
            .includes(deferredSearch) ||
          transaction.type.toLowerCase().includes(deferredSearch) ||
          transaction.details.toLowerCase().includes(deferredSearch) ||
          transaction.recordedAtLabel.toLowerCase().includes(deferredSearch) ||
          formatCurrency(Math.abs(transaction.amount))
            .toLowerCase()
            .includes(deferredSearch);

        return matchesType && matchesFlow && matchesSearch;
      }),
    [deferredSearch, flowFilter, transactions, typeFilter],
  );

  const hasActiveFilters =
    searchTerm.length > 0 || typeFilter !== "all" || flowFilter !== "all";

  return (
    <>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_220px_220px_auto]">
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
            setTypeFilter(
              event.target.value as CashTransactionLedgerRow["type"] | "all",
            )
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

      <div className="mb-4 text-sm text-dark-5 dark:text-dark-6">
        Showing {filteredTransactions.length} of {transactions.length}{" "}
        transactions
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Business date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Recorded</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredTransactions.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-10 text-center text-dark-5 dark:text-dark-6"
              >
                {transactions.length === 0
                  ? "No cash transactions recorded yet."
                  : "No cash transactions match the current search or filters."}
              </TableCell>
            </TableRow>
          ) : (
            filteredTransactions.map((transaction) => {
              const isInbound = transaction.amount >= 0;

              return (
                <TableRow key={transaction.id}>
                  <TableCell className="font-medium text-dark dark:text-white">
                    {transaction.businessDateLabel}
                  </TableCell>
                  <TableCell>{transaction.type}</TableCell>
                  <TableCell>
                    <div className="max-w-[360px] text-sm text-dark-5 dark:text-dark-6">
                      {transaction.details}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-dark-5 dark:text-dark-6">
                    {transaction.recordedAtLabel}
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
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </>
  );
}
