import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { normalizeExpenseCategory } from "@/lib/expenses/categories";
import { isRecurringExpenseMonthKey } from "@/lib/expenses/recurring";
import { requireExpenseManagerAccess } from "@/lib/expenses/api";

export const runtime = "nodejs";

type ExpenseBudgetEntryBody = {
  category?: unknown;
  budgetAmount?: unknown;
};

type SaveExpenseBudgetsBody = {
  budgetMonth?: unknown;
  entries?: unknown;
};

type ExistingExpenseBudgetRow = {
  id: string;
  category: string;
  created_by: string | null;
};

type ValidExpenseBudgetEntry = {
  category: string;
  budget_amount: number;
};

function normalizeBudgetMonth(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return isRecurringExpenseMonthKey(normalized) ? normalized : null;
}

function normalizeBudgetAmount(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return Math.round(normalized * 100) / 100;
}

function validateBudgetEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return { error: "Budget entries must be an array" };
  }

  const entriesByCategory = new Map<string, number>();

  for (const entry of value as ExpenseBudgetEntryBody[]) {
    const category = normalizeExpenseCategory(entry?.category);
    const budgetAmount = normalizeBudgetAmount(entry?.budgetAmount);

    if (!category) {
      return { error: "Each budget entry requires a category" };
    }

    if (budgetAmount === null) {
      return { error: "Each budget entry must be greater than 0" };
    }

    entriesByCategory.set(category, budgetAmount);
  }

  return {
    entries: Array.from(entriesByCategory.entries()).map(
      ([category, budget_amount]) =>
        ({
          category,
          budget_amount,
        }) satisfies ValidExpenseBudgetEntry,
    ),
  };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireExpenseManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as SaveExpenseBudgetsBody;
    const budgetMonth = normalizeBudgetMonth(body.budgetMonth);

    if (!budgetMonth) {
      return NextResponse.json(
        { error: "Budget month must be the first day of a month" },
        { status: 400 },
      );
    }

    const validation = validateBudgetEntries(body.entries ?? []);

    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const retainedEntries = validation.entries;
    const retainedCategories = new Set(
      retainedEntries.map((entry) => entry.category),
    );
    const existingResult = await access.supabase
      .from("expense_category_budgets")
      .select("id,category,created_by")
      .eq("store_key", access.activeStoreKey)
      .eq("budget_month", budgetMonth)
      .returns<ExistingExpenseBudgetRow[]>();

    if (existingResult.error) {
      return NextResponse.json(
        {
          error:
            existingResult.error.message ??
            "Failed to inspect existing expense budgets",
        },
        { status: 500 },
      );
    }

    const existingRows = existingResult.data ?? [];
    const existingByCategory = new Map(
      existingRows.map((row) => [
        normalizeExpenseCategory(row.category) ?? row.category,
        row,
      ]),
    );

    if (retainedEntries.length > 0) {
      const { error: upsertError } = await access.supabase
        .from("expense_category_budgets")
        .upsert(
          retainedEntries.map((entry) => ({
            store_key: access.activeStoreKey,
            budget_month: budgetMonth,
            category: entry.category,
            budget_amount: entry.budget_amount,
            created_by:
              existingByCategory.get(entry.category)?.created_by ??
              access.currentUser.id,
            updated_by: access.currentUser.id,
          })),
          {
            onConflict: "store_key,budget_month,category",
          },
        );

      if (upsertError) {
        return NextResponse.json(
          { error: upsertError.message ?? "Failed to save expense budgets" },
          { status: 500 },
        );
      }
    }

    const idsToDelete = existingRows
      .filter(
        (row) =>
          !retainedCategories.has(
            normalizeExpenseCategory(row.category) ?? row.category,
          ),
      )
      .map((row) => row.id);

    if (idsToDelete.length > 0) {
      const { error: deleteError } = await access.supabase
        .from("expense_category_budgets")
        .delete()
        .in("id", idsToDelete);

      if (deleteError) {
        return NextResponse.json(
          {
            error:
              deleteError.message ??
              "Failed to clean up removed expense budgets",
          },
          { status: 500 },
        );
      }
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "expense_budget",
      entityId: budgetMonth,
      action: "expense_budget.month_saved",
      summary: `Expense budgets saved for ${budgetMonth}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        budgetMonth,
        entryCount: retainedEntries.length,
        totalBudget: retainedEntries.reduce(
          (sum, entry) => sum + entry.budget_amount,
          0,
        ),
        deletedCount: idsToDelete.length,
      },
    });

    return NextResponse.json({
      budgetMonth,
      entryCount: retainedEntries.length,
    });
  } catch (error) {
    console.error("Expense budget save error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save expense budgets",
      },
      { status: 500 },
    );
  }
}
