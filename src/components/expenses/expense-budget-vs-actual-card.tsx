"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { SectionCard } from "@/components/erp/section-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ModalPortal } from "@/components/ui/modal-portal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useAppNotifications } from "@/contexts/NotificationContext";
import {
  buildExpenseBudgetSummary,
  buildExpenseBudgetVarianceRows,
  type ExpenseBudgetVarianceRow,
} from "@/lib/expenses/budgeting";
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenses/categories";
import { formatRecurringExpenseMonthLabel } from "@/lib/expenses/recurring";
import type { ExpenseCategoryBudget, ExpenseRecord } from "@/types/erp.types";

const INPUT_CLASSNAME = "app-input";

type ExpenseBudgetVsActualCardProps = {
  budgets: ExpenseCategoryBudget[];
  expenses: ExpenseRecord[];
  canManageExpenses: boolean;
  defaultMonthKey: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function toMonthInputValue(monthKey: string) {
  return monthKey.slice(0, 7);
}

function toMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value.trim()) ? `${value.trim()}-01` : null;
}

function toIsoDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getStatusTone(row: ExpenseBudgetVarianceRow) {
  if (row.status === "over_budget") {
    return "red" as const;
  }

  if (row.status === "unbudgeted") {
    return "amber" as const;
  }

  if (row.status === "under_budget") {
    return "green" as const;
  }

  return "blue" as const;
}

function getStatusLabel(row: ExpenseBudgetVarianceRow) {
  if (row.status === "over_budget") {
    return `Over by ${formatCurrency(Math.abs(row.variance))}`;
  }

  if (row.status === "unbudgeted") {
    return "Unbudgeted";
  }

  if (row.status === "under_budget") {
    return `Under by ${formatCurrency(row.variance)}`;
  }

  return "On target";
}

function orderCategories(categories: string[]) {
  const canonicalOrder = new Map(
    EXPENSE_CATEGORY_OPTIONS.map((category, index) => [category, index]),
  );

  return [...categories].sort((left, right) => {
    const leftIndex = canonicalOrder.get(left);
    const rightIndex = canonicalOrder.get(right);

    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }

    if (leftIndex !== undefined) {
      return -1;
    }

    if (rightIndex !== undefined) {
      return 1;
    }

    return left.localeCompare(right);
  });
}

export function ExpenseBudgetVsActualCard({
  budgets,
  expenses,
  canManageExpenses,
  defaultMonthKey,
}: ExpenseBudgetVsActualCardProps) {
  const router = useRouter();
  const { success: notifySuccess, error: notifyError } = useAppNotifications();
  const [selectedMonthKey, setSelectedMonthKey] = useState(defaultMonthKey);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const monthLabel = formatRecurringExpenseMonthLabel(selectedMonthKey);

  const budgetRows = useMemo(
    () => buildExpenseBudgetVarianceRows(expenses, budgets, selectedMonthKey),
    [budgets, expenses, selectedMonthKey],
  );
  const summary = useMemo(
    () => buildExpenseBudgetSummary(budgetRows),
    [budgetRows],
  );

  const budgetMapForMonth = useMemo(() => {
    const next = new Map<string, number>();

    budgets.forEach((budget) => {
      if (toIsoDateKey(budget.budgetMonth) !== selectedMonthKey) {
        return;
      }

      next.set(budget.category, budget.budgetAmount);
    });

    return next;
  }, [budgets, selectedMonthKey]);

  const editableCategories = useMemo(
    () =>
      orderCategories(
        Array.from(
          new Set([
            ...EXPENSE_CATEGORY_OPTIONS,
            ...budgetRows.map((row) => row.category),
            ...Array.from(budgetMapForMonth.keys()),
          ]),
        ),
      ),
    [budgetMapForMonth, budgetRows],
  );

  const openEditor = () => {
    setBudgetDrafts(
      Object.fromEntries(
        editableCategories.map((category) => [
          category,
          budgetMapForMonth.has(category)
            ? (budgetMapForMonth.get(category) ?? 0).toFixed(2)
            : "",
        ]),
      ),
    );
    setError("");
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    if (isSubmitting) {
      return;
    }

    setIsEditorOpen(false);
    setBudgetDrafts({});
    setError("");
  };

  const handleMonthChange = (value: string) => {
    const nextMonthKey = toMonthKey(value);

    if (!nextMonthKey) {
      return;
    }

    setSelectedMonthKey(nextMonthKey);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const entries = Object.entries(budgetDrafts)
      .map(([category, budgetAmount]) => ({
        category,
        normalizedAmount: budgetAmount.trim(),
      }))
      .filter((entry) => {
        if (entry.normalizedAmount.length === 0) {
          return false;
        }

        const numericValue = Number(entry.normalizedAmount);
        return Number.isFinite(numericValue) && numericValue > 0;
      })
      .map((entry) => ({
        category: entry.category,
        budgetAmount: entry.normalizedAmount,
      }));

    void (async () => {
      try {
        const response = await fetch("/api/expenses/budgets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            budgetMonth: selectedMonthKey,
            entries,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to save budgets");
        }

        notifySuccess(`Expense budgets saved for ${monthLabel}`);
        closeEditor();
        router.refresh();
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : "Failed to save budgets";

        setError(message);
        notifyError(message);
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <>
      <SectionCard
        title="Budget vs actual"
        description="Compare approved expense activity against saved monthly category budgets."
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <input
              type="month"
              value={toMonthInputValue(selectedMonthKey)}
              onChange={(event) => handleMonthChange(event.target.value)}
              className={INPUT_CLASSNAME}
            />
            <button
              type="button"
              onClick={openEditor}
              disabled={!canManageExpenses}
              className="app-secondary-button-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pencil className="h-4 w-4" />
              Edit budgets
            </button>
          </div>
        }
      >
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
            <div className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Budget total
            </div>
            <div className="mt-1 text-2xl font-semibold text-dark dark:text-white">
              {formatCurrency(summary.totalBudget)}
            </div>
            <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
              {monthLabel}
            </div>
          </div>
          <div className="rounded-[18px] border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
            <div className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Approved actual
            </div>
            <div className="mt-1 text-2xl font-semibold text-dark dark:text-white">
              {formatCurrency(summary.totalActual)}
            </div>
            <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
              {summary.budgetedCategories} budgeted categories
            </div>
          </div>
          <div className="rounded-[18px] border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
            <div className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Variance
            </div>
            <div
              className={`mt-1 text-2xl font-semibold ${
                summary.totalVariance < 0
                  ? "text-red"
                  : summary.totalVariance > 0
                    ? "text-green"
                    : "text-dark dark:text-white"
              }`}
            >
              {summary.totalVariance < 0
                ? `-${formatCurrency(Math.abs(summary.totalVariance))}`
                : formatCurrency(summary.totalVariance)}
            </div>
            <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
              {summary.overBudgetCategories} over budget /{" "}
              {summary.unbudgetedCategories} unbudgeted
            </div>
          </div>
        </div>

        <Table totalRows={budgetRows.length}>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {budgetRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                >
                  No budgets or approved expenses are recorded for {monthLabel}.
                </TableCell>
              </TableRow>
            ) : (
              budgetRows.map((row) => (
                <TableRow key={row.category}>
                  <TableCell>
                    <div className="font-semibold text-dark dark:text-white">
                      {row.category}
                    </div>
                    <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      {row.entries} approved entries
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {row.budget > 0 ? formatCurrency(row.budget) : "-"}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                    {formatCurrency(row.actual)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold ${
                      row.status === "over_budget"
                        ? "text-red"
                        : row.status === "under_budget"
                          ? "text-green"
                          : "text-dark dark:text-white"
                    }`}
                  >
                    {row.status === "over_budget"
                      ? `-${formatCurrency(Math.abs(row.variance))}`
                      : formatCurrency(row.variance)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={getStatusTone(row)}>
                      {getStatusLabel(row)}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>

      {isEditorOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Edit monthly expense budgets"
              className="modal-card-scroll max-w-4xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark"
            >
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Edit expense budgets
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Save category budgets for {monthLabel}. Leave a value blank
                    to remove that category budget.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={isSubmitting}
                  className="app-icon-button disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Close budget editor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="border-b border-stroke/80">
                        <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Category
                        </th>
                        <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Current budget
                        </th>
                        <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Approved actual
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {editableCategories.map((category) => {
                        const row =
                          budgetRows.find(
                            (budgetRow) => budgetRow.category === category,
                          ) ?? null;

                        return (
                          <tr
                            key={category}
                            className="border-b border-stroke/70 last:border-0"
                          >
                            <td className="px-3 py-3 font-medium text-dark dark:text-white">
                              {category}
                            </td>
                            <td className="px-3 py-3">
                              <CurrencyInput
                                value={budgetDrafts[category] ?? ""}
                                onValueChange={(decimalValue) =>
                                  setBudgetDrafts((current) => ({
                                    ...current,
                                    [category]: decimalValue,
                                  }))
                                }
                                className={`${INPUT_CLASSNAME} text-right`}
                                placeholder="0.00"
                              />
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-dark dark:text-white">
                              {row ? formatCurrency(row.actual) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {error ? (
                  <div className="mt-4 rounded-xl border border-red/20 bg-red/10 px-4 py-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeEditor}
                    disabled={isSubmitting}
                    className="app-secondary-button-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save budgets
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
