import { NextRequest, NextResponse } from "next/server";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { requireExpenseManagerAccess } from "@/lib/expenses/api";
import {
  createRecurringExpenseDraft,
  type StoredRecurringExpenseTemplate,
} from "@/lib/expenses/recurring-drafts";
import {
  getRecurringExpenseMonthKey,
  isRecurringExpenseMonthKey,
} from "@/lib/expenses/recurring";

export const runtime = "nodejs";

type GenerateRecurringExpenseBody = {
  id?: unknown;
  periodMonth?: unknown;
};

type AccessContext = Awaited<ReturnType<typeof requireExpenseManagerAccess>>;
type RecurringExpenseAccess = Exclude<AccessContext, { error: NextResponse }>;

type LoadedRecurringTemplateResult =
  | {
      error: NextResponse;
    }
  | {
      access: RecurringExpenseAccess;
      template: StoredRecurringExpenseTemplate;
    };

function getTemplateId(body: GenerateRecurringExpenseBody) {
  return typeof body.id === "string" ? body.id.trim() : "";
}

function normalizeRecurringPeriodMonth(
  value: unknown,
  activeStoreTimeZone: string,
) {
  if (typeof value === "string" && isRecurringExpenseMonthKey(value.trim())) {
    return value.trim();
  }

  const todayKey = getTodayIsoDateInTimeZone(activeStoreTimeZone);
  return getRecurringExpenseMonthKey(todayKey) ?? todayKey.slice(0, 7) + "-01";
}

async function loadStoredTemplate(
  id: string,
): Promise<LoadedRecurringTemplateResult> {
  const access = await requireExpenseManagerAccess();

  if ("error" in access) {
    return {
      error:
        access.error ??
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!id) {
    return {
      error: NextResponse.json(
        { error: "Recurring template id is required" },
        { status: 400 },
      ),
    };
  }

  const { data, error } = await access.supabase
    .from("recurring_expense_templates")
    .select(
      "id,category,default_amount,default_tax_amount,description,due_day_of_month,supplier_id,vendor_name,payment_method,notes,active",
    )
    .eq("id", id)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<StoredRecurringExpenseTemplate>();

  if (error) {
    return {
      error: NextResponse.json(
        { error: error.message ?? "Failed to load recurring template" },
        { status: 500 },
      ),
    };
  }

  if (!data) {
    return {
      error: NextResponse.json(
        { error: "Recurring template not found" },
        { status: 404 },
      ),
    };
  }

  return {
    access,
    template: data,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRecurringExpenseBody;
    const loaded = await loadStoredTemplate(getTemplateId(body));

    if ("error" in loaded) {
      return loaded.error;
    }

    if (!(loaded.template.active ?? true)) {
      return NextResponse.json(
        { error: "Paused recurring templates cannot create drafts" },
        { status: 409 },
      );
    }

    const recurringPeriodMonth = normalizeRecurringPeriodMonth(
      body.periodMonth,
      loaded.access.activeStoreTimeZone,
    );
    const result = await createRecurringExpenseDraft({
      access: loaded.access,
      template: loaded.template,
      recurringPeriodMonth,
      mode: "manual",
    });

    if (!result.created) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(result.data, { status: 201 });
  } catch (error) {
    console.error("Recurring expense draft generation error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create recurring expense draft",
      },
      { status: 500 },
    );
  }
}
