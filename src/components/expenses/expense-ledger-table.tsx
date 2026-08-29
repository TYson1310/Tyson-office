"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  AddExpenseButton,
  type EditableExpenseRecord,
} from "@/components/expenses/add-expense-button";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { ExpenseStatusButton } from "@/components/expenses/expense-status-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorAttachmentActions } from "@/components/vendors/vendor-attachment-actions";
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenses/categories";
import type { ExpenseRecord } from "@/types/erp.types";

const COMPACT_CONTROL_CLASSNAME =
  "h-8 w-full rounded-lg border border-slate-200 bg-white/90 px-3 text-xs font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

type ExpenseLedgerTableProps = {
  expenses: ExpenseRecord[];
  canManageExpenses: boolean;
};

function expenseStatusTone(status: EditableExpenseRecord["status"]) {
  if (status === "approved") {
    return "green";
  }

  if (status === "void") {
    return "slate";
  }

  return "amber";
}

function formatExpenseStatus(status: EditableExpenseRecord["status"]) {
  if (status === "approved") {
    return "Approved";
  }

  if (status === "void") {
    return "Voided";
  }

  return "Draft";
}

function formatDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatPaymentMethod(value: string | undefined) {
  if (!value) {
    return "Not set";
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function ExpenseLedgerTable({
  expenses,
  canManageExpenses,
}: ExpenseLedgerTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("approved");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());

  const categoryOptions = useMemo(() => {
    const expenseCategories = expenses
      .map((expense) => expense.category.trim())
      .filter(Boolean);

    return Array.from(
      new Set([...EXPENSE_CATEGORY_OPTIONS, ...expenseCategories]),
    ).sort((left, right) => left.localeCompare(right));
  }, [expenses]);

  const hasInvalidDateRange = Boolean(
    startDate && endDate && startDate > endDate,
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((expense) => {
        if (deferredSearch.length === 0) {
          return true;
        }

        const dateLabel = formatDateInput(expense.date);
        const paymentMethodLabel = formatPaymentMethod(expense.paymentMethod);
        const statusLabel = formatExpenseStatus(expense.status);
        const searchableValues = [
          dateLabel,
          expense.description,
          expense.category,
          expense.vendorName ?? "",
          paymentMethodLabel,
          statusLabel,
          expense.notes ?? "",
          expense.approvalNote ?? "",
          expense.voidNote ?? "",
          expense.attachmentName ?? "",
          expense.amount.toFixed(2),
          formatCurrency(expense.amount),
        ];

        return searchableValues.some((value) =>
          value.toLowerCase().includes(deferredSearch),
        );
      }),
    [deferredSearch, expenses],
  );

  const visibleExpenses = useMemo(
    () =>
      filteredExpenses.filter((expense) => {
        const expenseDate = formatDateInput(expense.date);

        if (
          selectedCategory !== "all" &&
          expense.category !== selectedCategory
        ) {
          return false;
        }

        if (selectedStatus === "active" && expense.status === "void") {
          return false;
        }

        if (selectedStatus !== "all" && selectedStatus !== "active") {
          if (expense.status !== selectedStatus) {
            return false;
          }
        }

        if (!hasInvalidDateRange && startDate && expenseDate < startDate) {
          return false;
        }

        if (!hasInvalidDateRange && endDate && expenseDate > endDate) {
          return false;
        }

        return true;
      }),
    [
      endDate,
      filteredExpenses,
      hasInvalidDateRange,
      selectedCategory,
      selectedStatus,
      startDate,
    ],
  );

  const visibleTotal = useMemo(
    () => visibleExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    [visibleExpenses],
  );

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    selectedCategory !== "all" ||
    selectedStatus !== "approved" ||
    startDate.length > 0 ||
    endDate.length > 0;

  const activeSelectionFilterCount = [
    selectedCategory !== "all",
    selectedStatus !== "approved",
    startDate.length > 0 || endDate.length > 0,
  ].filter(Boolean).length;

  const filtersAreVisible = showFilters || hasInvalidDateRange;

  function resetFilters() {
    setSearchTerm("");
    setSelectedCategory("all");
    setSelectedStatus("approved");
    setStartDate("");
    setEndDate("");
    setShowFilters(false);
  }

  return (
    <>
      <div className="mb-3 rounded-xl border border-stroke bg-white px-2.5 py-2 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search expenses</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-5 dark:text-dark-6" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className={`${COMPACT_CONTROL_CLASSNAME} pl-8`}
              placeholder="Search expenses"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 text-xs text-dark-5 dark:text-dark-6">
            <span>
              {visibleExpenses.length}/{expenses.length}
            </span>
            <span className="font-semibold text-dark dark:text-white">
              {formatCurrency(visibleTotal)}
            </span>
            <button
              type="button"
              onClick={() => setShowFilters((isVisible) => !isVisible)}
              aria-expanded={filtersAreVisible}
              aria-controls="expense-ledger-filters"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-stroke px-2.5 text-xs font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-white"
              title="Expense filters"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeSelectionFilterCount > 0 ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-white">
                  {activeSelectionFilterCount}
                </span>
              ) : null}
            </button>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-stroke px-2.5 text-xs font-semibold text-dark-5 transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
                title="Reset filters"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            ) : null}
          </div>
        </div>

        {filtersAreVisible ? (
          <div
            id="expense-ledger-filters"
            className="mt-2 grid gap-2 border-t border-stroke pt-2 dark:border-dark-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-dark-5 dark:text-dark-6">
                Category
              </span>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className={COMPACT_CONTROL_CLASSNAME}
              >
                <option value="all">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-dark-5 dark:text-dark-6">
                Status
              </span>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className={COMPACT_CONTROL_CLASSNAME}
              >
                <option value="approved">Approved</option>
                <option value="active">Draft + approved</option>
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="void">Voided</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-dark-5 dark:text-dark-6">
                Start date
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={COMPACT_CONTROL_CLASSNAME}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-dark-5 dark:text-dark-6">
                End date
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={COMPACT_CONTROL_CLASSNAME}
              />
            </label>
          </div>
        ) : null}

        {hasInvalidDateRange ? (
          <div className="mt-2 text-xs font-medium text-red">
            Start date must be on or before end date.
          </div>
        ) : null}
      </div>

      <Table totalRows={visibleExpenses.length}>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Expense</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Payee</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleExpenses.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
              >
                {expenses.length === 0
                  ? "No expenses have been recorded for this store yet."
                  : "No expenses match the current filters."}
              </TableCell>
            </TableRow>
          ) : (
            visibleExpenses.map((expense) => {
              const editableExpense: EditableExpenseRecord = {
                id: expense.id,
                category: expense.category,
                amount: expense.amount,
                subtotalAmount: expense.subtotalAmount,
                taxAmount: expense.taxAmount,
                description: expense.description,
                expenseDate: formatDateInput(expense.date),
                vendorName: expense.vendorName ?? "",
                paymentMethod: expense.paymentMethod ?? "",
                notes: expense.notes ?? "",
                status: expense.status,
                attachmentName: expense.attachmentName,
                attachmentUrl: expense.attachmentUrl,
              };

              return (
                <TableRow key={expense.id}>
                  <TableCell>{formatDateInput(expense.date)}</TableCell>
                  <TableCell>
                    <div className="font-semibold text-dark dark:text-white">
                      {expense.description}
                    </div>
                    {expense.notes ? (
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {expense.notes}
                      </div>
                    ) : null}
                    {expense.approvalNote ? (
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        <span className="font-medium text-dark dark:text-white">
                          Approval note:
                        </span>{" "}
                        {expense.approvalNote}
                      </div>
                    ) : null}
                    {expense.voidNote ? (
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        <span className="font-medium text-dark dark:text-white">
                          Void note:
                        </span>{" "}
                        {expense.voidNote}
                      </div>
                    ) : null}
                    {expense.attachmentUrl ? (
                      <div className="mt-2">
                        <VendorAttachmentActions
                          href={expense.attachmentUrl}
                          label={expense.attachmentName ?? "Bill copy"}
                          title="Expense document"
                        />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{expense.category}</TableCell>
                  <TableCell>{expense.vendorName ?? "-"}</TableCell>
                  <TableCell>
                    {formatPaymentMethod(expense.paymentMethod)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={expenseStatusTone(expense.status)}>
                      {formatExpenseStatus(expense.status)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(expense.amount)}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      {expense.status === "draft" ? (
                        <ExpenseStatusButton
                          expenseId={expense.id}
                          expenseName={expense.description}
                          action="approved"
                          disabled={!canManageExpenses}
                        />
                      ) : null}
                      {expense.status === "draft" ? (
                        <AddExpenseButton
                          expense={editableExpense}
                          iconOnly
                          disabled={!canManageExpenses}
                        />
                      ) : null}
                      {expense.status !== "void" ? (
                        <DeleteExpenseButton
                          expenseId={expense.id}
                          expenseName={expense.description}
                          disabled={!canManageExpenses}
                        />
                      ) : null}
                    </div>
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
