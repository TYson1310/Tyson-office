import { normalizeExpenseCategory } from "@/lib/expenses/categories";
import type { ExpenseCategoryBudget, ExpenseRecord } from "@/types/erp.types";

export type ExpenseBudgetVarianceStatus =
  | "on_target"
  | "under_budget"
  | "over_budget"
  | "unbudgeted";

export type ExpenseBudgetVarianceRow = {
  category: string;
  budget: number;
  actual: number;
  variance: number;
  entries: number;
  status: ExpenseBudgetVarianceStatus;
};

export type ExpenseBudgetSummary = {
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  budgetedCategories: number;
  overBudgetCategories: number;
  unbudgetedCategories: number;
};

function toIsoDateKey(value: Date | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function monthStartFromKey(monthKey: string) {
  if (!/^\d{4}-\d{2}-01$/.test(monthKey.trim())) {
    return null;
  }

  const [yearLabel, monthLabel] = monthKey.trim().split("-");
  const year = Number(yearLabel);
  const month = Number(monthLabel);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
}

function addMonth(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1, 12, 0, 0),
  );
}

export function buildExpenseBudgetVarianceRows(
  expenses: ExpenseRecord[],
  budgets: ExpenseCategoryBudget[],
  monthKey: string,
): ExpenseBudgetVarianceRow[] {
  const start = monthStartFromKey(monthKey);

  if (!start) {
    return [];
  }

  const end = addMonth(start);
  const budgetByCategory = new Map<string, number>();

  budgets.forEach((budget) => {
    if (toIsoDateKey(budget.budgetMonth) !== monthKey) {
      return;
    }

    const category =
      normalizeExpenseCategory(budget.category) ?? budget.category;
    budgetByCategory.set(
      category,
      (budgetByCategory.get(category) ?? 0) + budget.budgetAmount,
    );
  });

  const actualByCategory = new Map<
    string,
    { total: number; entries: number }
  >();

  expenses.forEach((expense) => {
    if (expense.status !== "approved") {
      return;
    }

    if (expense.date < start || expense.date >= end) {
      return;
    }

    const category = normalizeExpenseCategory(expense.category) ?? "Other";
    const current = actualByCategory.get(category) ?? { total: 0, entries: 0 };
    current.total += expense.amount;
    current.entries += 1;
    actualByCategory.set(category, current);
  });

  return Array.from(
    new Set([...budgetByCategory.keys(), ...actualByCategory.keys()]),
  )
    .map((category) => {
      const budget = budgetByCategory.get(category) ?? 0;
      const actual = actualByCategory.get(category)?.total ?? 0;
      const entries = actualByCategory.get(category)?.entries ?? 0;
      const variance = budget - actual;
      const status: ExpenseBudgetVarianceStatus =
        budget <= 0 && actual > 0
          ? "unbudgeted"
          : variance < 0
            ? "over_budget"
            : variance > 0
              ? "under_budget"
              : "on_target";

      return {
        category,
        budget,
        actual,
        variance,
        entries,
        status,
      };
    })
    .sort(
      (left, right) =>
        Math.max(right.actual, right.budget) -
          Math.max(left.actual, left.budget) ||
        right.actual - left.actual ||
        left.category.localeCompare(right.category),
    );
}

export function buildExpenseBudgetSummary(
  rows: ExpenseBudgetVarianceRow[],
): ExpenseBudgetSummary {
  return rows.reduce<ExpenseBudgetSummary>(
    (summary, row) => {
      summary.totalBudget += row.budget;
      summary.totalActual += row.actual;
      summary.totalVariance += row.variance;

      if (row.budget > 0) {
        summary.budgetedCategories += 1;
      }

      if (row.status === "over_budget") {
        summary.overBudgetCategories += 1;
      }

      if (row.status === "unbudgeted") {
        summary.unbudgetedCategories += 1;
      }

      return summary;
    },
    {
      totalBudget: 0,
      totalActual: 0,
      totalVariance: 0,
      budgetedCategories: 0,
      overBudgetCategories: 0,
      unbudgetedCategories: 0,
    },
  );
}
