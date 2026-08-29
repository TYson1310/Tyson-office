import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { appendAuditEvent } from "@/lib/audit/events";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { buildExpenseAmountBreakdown } from "@/lib/expenses/expense-records";
import { requireExpenseManagerAccess } from "@/lib/expenses/api";
import {
  getRecurringExpenseMonthKey,
  resolveRecurringExpenseDate,
} from "@/lib/expenses/recurring";
import type { NextResponse } from "next/server";

type AccessContext = Awaited<ReturnType<typeof requireExpenseManagerAccess>>;
type RecurringExpenseAccess = Exclude<AccessContext, { error: NextResponse }>;

export type StoredRecurringExpenseTemplate = {
  id: string;
  category: string;
  default_amount: number | string;
  default_tax_amount: number | string | null;
  description: string;
  due_day_of_month: number;
  supplier_id: string | null;
  vendor_name: string | null;
  payment_method: string | null;
  notes: string | null;
  active: boolean | null;
};

type ExistingRecurringExpense = {
  id: string;
  status: "draft" | "approved";
};

type CreateRecurringExpenseDraftInput = {
  access: RecurringExpenseAccess;
  template: StoredRecurringExpenseTemplate;
  recurringPeriodMonth: string;
  mode: "manual" | "automatic";
};

type CreateRecurringExpenseDraftResult =
  | {
      data: { id: string; description: string };
      expenseDate: string;
      created: true;
    }
  | {
      created: false;
      error: string;
      status: number;
    };

function normalizeRecurringTemplateAmount(value: number | string | null) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function isMissingRecurringDraftSchema(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("recurring_expense_templates") ||
    message.includes("recurring_template_id") ||
    message.includes("recurring_period_month") ||
    message.includes("default_tax_amount") ||
    message.includes("supplier_id")
  );
}

export function shouldAutoGenerateRecurringExpenseDraft(input: {
  currentMonthKey: string;
  todayDateKey: string;
  template: Pick<
    StoredRecurringExpenseTemplate,
    "active" | "due_day_of_month"
  >;
  hasExistingDraft: boolean;
}) {
  if (!(input.template.active ?? true)) {
    return false;
  }

  if (input.hasExistingDraft) {
    return false;
  }

  const recurringExpenseDate = resolveRecurringExpenseDate(
    input.currentMonthKey,
    input.template.due_day_of_month,
  );

  if (!recurringExpenseDate) {
    return false;
  }

  return recurringExpenseDate <= input.todayDateKey;
}

export async function createRecurringExpenseDraft({
  access,
  template,
  recurringPeriodMonth,
  mode,
}: CreateRecurringExpenseDraftInput): Promise<CreateRecurringExpenseDraftResult> {
  if (!(template.active ?? true)) {
    return {
      created: false,
      error: "Paused recurring templates cannot create drafts",
      status: 409,
    };
  }

  const expenseDate = resolveRecurringExpenseDate(
    recurringPeriodMonth,
    template.due_day_of_month,
  );

  if (!expenseDate) {
    return {
      created: false,
      error: "Recurring period month is invalid",
      status: 400,
    };
  }

  const periodLock = await assertAccountingPeriodUnlocked(
    access.supabase,
    access.activeStoreKey,
    expenseDate,
    `Recurring expense ${template.description}`,
  );

  if (periodLock) {
    return {
      created: false,
      error: periodLock.error,
      status: periodLock.status,
    };
  }

  const existingExpenseResult = await access.supabase
    .from("expense_records")
    .select("id,status")
    .eq("store_key", access.activeStoreKey)
    .eq("recurring_template_id", template.id)
    .eq("recurring_period_month", recurringPeriodMonth)
    .in("status", ["draft", "approved"])
    .maybeSingle<ExistingRecurringExpense>();

  if (existingExpenseResult.error) {
    return {
      created: false,
      error:
        existingExpenseResult.error.message ??
        "Failed to inspect existing recurring drafts",
      status: 500,
    };
  }

  if (existingExpenseResult.data) {
    return {
      created: false,
      error:
        existingExpenseResult.data.status === "approved"
          ? "This recurring expense is already approved for the selected month."
          : "A draft already exists for this recurring expense in the selected month.",
      status: 409,
    };
  }

  const breakdown = buildExpenseAmountBreakdown(
    normalizeRecurringTemplateAmount(template.default_amount),
    normalizeRecurringTemplateAmount(template.default_tax_amount),
  );

  if (!breakdown) {
    return {
      created: false,
      error: "Recurring template amount is invalid",
      status: 400,
    };
  }

  const { data, error } = await access.supabase
    .from("expense_records")
    .insert({
      store_key: access.activeStoreKey,
      category: template.category,
      amount: breakdown.totalAmount,
      subtotal_amount: breakdown.subtotalAmount,
      tax_amount: breakdown.taxAmount,
      description: template.description,
      expense_date: expenseDate,
      supplier_id: template.supplier_id,
      vendor_name: template.vendor_name,
      payment_method: template.payment_method,
      notes: template.notes,
      status: "draft",
      created_by: access.currentUser.id,
      approved_by: null,
      approved_at: null,
      approval_note: null,
      voided_by: null,
      voided_at: null,
      void_note: null,
      recurring_template_id: template.id,
      recurring_period_month: recurringPeriodMonth,
    })
    .select("id,description")
    .single<{ id: string; description: string }>();

  if (error || !data) {
    const isDuplicate =
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505";

    return {
      created: false,
      error: isDuplicate
        ? "A recurring expense draft already exists for the selected month."
        : (error?.message ?? "Failed to create recurring expense draft"),
      status: isDuplicate ? 409 : 500,
    };
  }

  await appendAuditEvent({
    supabase: access.supabase,
    storeKey: access.activeStoreKey,
    entityType: "expense",
    entityId: data.id,
    action: "expense.drafted",
    summary:
      mode === "automatic"
        ? `Automatic recurring expense drafted: ${template.description}`
        : `Draft recurring expense created: ${template.description}`,
    actorId: access.currentUser.id,
    actorName: access.currentUserName,
    actorRole: access.currentUserRole ?? "employee",
    metadata: {
      recurringTemplateId: template.id,
      recurringPeriodMonth,
      expenseDate,
      amount: breakdown.totalAmount,
      taxAmount: breakdown.taxAmount,
      generationMode: mode,
    },
  });

  return {
    data,
    expenseDate,
    created: true,
  };
}

export async function ensureDueRecurringExpenseDraftsForActiveStore() {
  const access = await requireExpenseManagerAccess();

  if ("error" in access) {
    return { createdCount: 0, compatibilityMode: false };
  }

  const todayDateKey = getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
  const currentMonthKey =
    getRecurringExpenseMonthKey(todayDateKey) ?? `${todayDateKey.slice(0, 7)}-01`;

  const templatesResult = await access.supabase
    .from("recurring_expense_templates")
    .select(
      "id,category,default_amount,default_tax_amount,description,due_day_of_month,supplier_id,vendor_name,payment_method,notes,active",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("active", true)
    .order("due_day_of_month", { ascending: true })
    .returns<StoredRecurringExpenseTemplate[]>();

  if (templatesResult.error) {
    if (isMissingRecurringDraftSchema(templatesResult.error)) {
      return { createdCount: 0, compatibilityMode: true };
    }

    console.error(
      "Automatic recurring expense template load error:",
      templatesResult.error.message ?? templatesResult.error,
    );
    return { createdCount: 0, compatibilityMode: false };
  }

  const existingExpensesResult = await access.supabase
    .from("expense_records")
    .select("recurring_template_id,status")
    .eq("store_key", access.activeStoreKey)
    .eq("recurring_period_month", currentMonthKey)
    .in("status", ["draft", "approved"]);

  if (existingExpensesResult.error) {
    if (isMissingRecurringDraftSchema(existingExpensesResult.error)) {
      return { createdCount: 0, compatibilityMode: true };
    }

    console.error(
      "Automatic recurring expense inspection error:",
      existingExpensesResult.error.message ?? existingExpensesResult.error,
    );
    return { createdCount: 0, compatibilityMode: false };
  }

  const existingTemplateIds = new Set(
    (existingExpensesResult.data ?? [])
      .map((expense) => expense.recurring_template_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  let createdCount = 0;

  for (const template of templatesResult.data ?? []) {
    if (
      !shouldAutoGenerateRecurringExpenseDraft({
        currentMonthKey,
        todayDateKey,
        template,
        hasExistingDraft: existingTemplateIds.has(template.id),
      })
    ) {
      continue;
    }

    const result = await createRecurringExpenseDraft({
      access,
      template,
      recurringPeriodMonth: currentMonthKey,
      mode: "automatic",
    });

    if (result.created) {
      existingTemplateIds.add(template.id);
      createdCount += 1;
      continue;
    }

    if (result.status !== 409) {
      console.error("Automatic recurring expense draft error:", result.error);
    }
  }

  return { createdCount, compatibilityMode: false };
}
