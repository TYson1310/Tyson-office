import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { AddExpenseButton } from "@/components/expenses/add-expense-button";
import { ExpenseBudgetVsActualCard } from "@/components/expenses/expense-budget-vs-actual-card";
import { ExpenseLedgerTable } from "@/components/expenses/expense-ledger-table";
import { RecurringExpenseTemplatesCard } from "@/components/expenses/recurring-expense-templates-card";
import {
  dateKeyToUtcNoonDate,
  getCurrentMonthStartIsoDateInTimeZone,
  getCurrentYearStartIsoDateInTimeZone,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import {
  formatCurrency,
  getMonthToDateFinancials,
  getOperationsDataset,
} from "@/lib/erp/operations";
import { buildExpenseCategoryRows } from "@/lib/erp/reporting";
import { ensureDueRecurringExpenseDraftsForActiveStore } from "@/lib/expenses/recurring-drafts";
import { getRecurringExpenseMonthKey } from "@/lib/expenses/recurring";
import { requireActiveStoreContext } from "@/lib/stores/server";

export const metadata: Metadata = {
  title: "General Expenses",
};

export default async function GeneralExpensesPage() {
  const storeContext = await requireActiveStoreContext();
  await ensureDueRecurringExpenseDraftsForActiveStore();
  const dataset = await getOperationsDataset();
  const canManageExpenses = dataset.source === "database";
  const currentMonthKey =
    getRecurringExpenseMonthKey(
      getCurrentMonthStartIsoDateInTimeZone(storeContext.activeStore.timeZone),
    ) ??
    getCurrentMonthStartIsoDateInTimeZone(storeContext.activeStore.timeZone);
  const todayDateKey = getTodayIsoDateInTimeZone(
    storeContext.activeStore.timeZone,
  );
  const monthStart = dateKeyToUtcNoonDate(currentMonthKey);
  const yearStart = dateKeyToUtcNoonDate(
    getCurrentYearStartIsoDateInTimeZone(storeContext.activeStore.timeZone),
  );
  const approvedExpenses = dataset.expenses.filter(
    (expense) => expense.status === "approved",
  );
  const draftExpenses = dataset.expenses.filter(
    (expense) => expense.status === "draft",
  );
  const monthApprovedTotal = approvedExpenses
    .filter((expense) => expense.date >= monthStart)
    .reduce((sum, expense) => sum + expense.amount, 0);
  const yearApprovedTotal = approvedExpenses
    .filter((expense) => expense.date >= yearStart)
    .reduce((sum, expense) => sum + expense.amount, 0);
  const draftTotal = draftExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const averageApprovedExpense =
    approvedExpenses.length === 0
      ? 0
      : approvedExpenses.reduce((sum, expense) => sum + expense.amount, 0) /
        approvedExpenses.length;
  const monthFinancials = getMonthToDateFinancials(dataset, {
    startDate: monthStart,
    startDateKey: currentMonthKey,
    timeZone: storeContext.activeStore.timeZone,
  });
  const monthCategories = buildExpenseCategoryRows(dataset, {
    start: monthStart,
  });
  const topCategory = monthCategories[0];
  const metrics = [
    {
      label: "Approved This Month",
      value: formatCurrency(monthApprovedTotal),
      change: `${monthCategories.length} categories`,
      detail: "counted in net profit",
      tone: "green" as const,
    },
    {
      label: "Draft Expenses",
      value: formatCurrency(draftTotal),
      change: `${draftExpenses.length} entries`,
      detail: "excluded until approved",
      tone: "amber" as const,
    },
    {
      label: "YTD Approved",
      value: formatCurrency(yearApprovedTotal),
      change: topCategory?.category ?? "No category",
      detail: "largest current-month category",
      tone: "blue" as const,
    },
    {
      label: "MTD Net Profit",
      value: formatCurrency(monthFinancials.netProfit),
      change: formatCurrency(averageApprovedExpense),
      detail: "average approved expense",
      tone: "violet" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="General Expenses" />

      {dataset.source !== "database" ? (
        <div className="mb-6 rounded-[24px] border border-dashed border-primary/30 bg-primary/5 px-5 py-4 text-sm text-dark-5 dark:text-dark-6">
          Supabase expense records are not available yet. Configure the database
          connection to manage store expenses and calculate net profit from live
          entries.
        </div>
      ) : null}

      <OperationsCompatibilityNotice
        warnings={dataset.compatibilityWarnings}
        className="mb-6"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Expense ledger"
          description="Track store expenses, utility bills, and supporting copies. Only approved entries flow into net profit."
          action={
            <AddExpenseButton
              defaultExpenseDate={todayDateKey}
              disabled={!canManageExpenses}
            />
          }
        >
          <ExpenseLedgerTable
            expenses={dataset.expenses}
            canManageExpenses={canManageExpenses}
          />
        </SectionCard>

        <div className="mt-6 space-y-6">
          <ExpenseBudgetVsActualCard
            budgets={dataset.expenseCategoryBudgets}
            expenses={dataset.expenses}
            canManageExpenses={canManageExpenses}
            defaultMonthKey={currentMonthKey}
          />

          <RecurringExpenseTemplatesCard
            templates={dataset.recurringExpenseTemplates}
            expenses={dataset.expenses}
            canManageExpenses={canManageExpenses}
            currentMonthKey={currentMonthKey}
          />

          <SectionCard
            title="Category mix"
            description="Approved expense categories for the current month."
          >
            <div className="space-y-4">
              {monthCategories.length === 0 ? (
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  No approved expenses have been posted this month yet.
                </p>
              ) : (
                monthCategories.map((category) => (
                  <div key={category.category}>
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                      <div>
                        <div className="font-medium text-dark dark:text-white">
                          {category.category}
                        </div>
                        <div className="text-xs text-dark-5 dark:text-dark-6">
                          {category.entries} entries · avg{" "}
                          {formatCurrency(category.averageAmount)}
                        </div>
                      </div>
                      <div className="text-right font-semibold text-dark dark:text-white">
                        <div>{formatCurrency(category.total)}</div>
                        <div className="text-xs text-dark-5 dark:text-dark-6">
                          {category.share.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-dark-3">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.min(category.share, 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Net Profit Impact"
            description="Current month profitability for the selected store after approved expenses."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Revenue
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(monthFinancials.revenue)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Gross Profit
                </span>
                <span className="font-semibold text-dark dark:text-white">
                  {formatCurrency(monthFinancials.grossProfit)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Approved Expenses
                </span>
                <span className="text-amber font-semibold">
                  {formatCurrency(monthFinancials.expenses)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  Net Profit
                </span>
                <span className="font-semibold text-green">
                  {formatCurrency(monthFinancials.netProfit)}
                </span>
              </div>
              <div className="rounded-[18px] bg-gray-1 px-4 py-3 text-sm text-dark-5 dark:bg-dark-2 dark:text-dark-6">
                Draft expenses stay off the P&amp;L until they are approved from
                this ledger.
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
