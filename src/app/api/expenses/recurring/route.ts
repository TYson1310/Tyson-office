import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { normalizeExpenseCategory } from "@/lib/expenses/categories";
import { validateExpenseSupplierId } from "@/lib/expenses/api";
import { buildExpenseAmountBreakdown } from "@/lib/expenses/expense-records";
import {
  clampRecurringExpenseDueDay,
  RECURRING_EXPENSE_MAX_DUE_DAY,
  RECURRING_EXPENSE_MIN_DUE_DAY,
} from "@/lib/expenses/recurring";
import { requireExpenseManagerAccess } from "@/lib/expenses/api";

export const runtime = "nodejs";

const ALLOWED_PAYMENT_METHODS = new Set([
  "cash",
  "card",
  "mobile",
  "bank_transfer",
  "check",
  "other",
]);

type RecurringExpenseTemplateBody = {
  id?: unknown;
  category?: unknown;
  defaultAmount?: unknown;
  defaultTaxAmount?: unknown;
  description?: unknown;
  dueDayOfMonth?: unknown;
  supplierId?: unknown;
  vendorName?: unknown;
  paymentMethod?: unknown;
  notes?: unknown;
  active?: unknown;
};

type StoredRecurringExpenseTemplate = {
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
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AccessContext = Awaited<ReturnType<typeof requireExpenseManagerAccess>>;
type RecurringExpenseAccess = Exclude<AccessContext, { error: NextResponse }>;

type ValidRecurringExpenseTemplatePayload = {
  category: string;
  default_amount: number;
  default_tax_amount: number;
  description: string;
  due_day_of_month: number;
  supplier_id: string | null;
  vendor_name: string | null;
  payment_method: string | null;
  notes: string | null;
  active: boolean;
};

type LoadedRecurringTemplateResult =
  | {
      error: NextResponse;
    }
  | {
      access: RecurringExpenseAccess;
      template: StoredRecurringExpenseTemplate;
    };

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizePaymentMethod(value: unknown) {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  return normalized && ALLOWED_PAYMENT_METHODS.has(normalized)
    ? normalized
    : null;
}

function normalizeAmount(value: unknown) {
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

function normalizeNonNegativeAmount(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }

  return Math.round(normalized * 100) / 100;
}

function normalizeOptionalId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDueDayOfMonth(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(normalized)) {
    return null;
  }

  if (
    normalized < RECURRING_EXPENSE_MIN_DUE_DAY ||
    normalized > RECURRING_EXPENSE_MAX_DUE_DAY
  ) {
    return null;
  }

  return clampRecurringExpenseDueDay(normalized);
}

function normalizeActive(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return true;
}

function getTemplateId(body: RecurringExpenseTemplateBody) {
  return typeof body.id === "string" ? body.id.trim() : "";
}

function validateTemplatePayload(body: RecurringExpenseTemplateBody) {
  const category = normalizeExpenseCategory(body.category);
  const description = normalizeOptionalString(body.description);
  const defaultAmount = normalizeAmount(body.defaultAmount);
  const defaultTaxAmount =
    body.defaultTaxAmount === undefined ||
    body.defaultTaxAmount === null ||
    body.defaultTaxAmount === ""
      ? 0
      : normalizeNonNegativeAmount(body.defaultTaxAmount);
  const dueDayOfMonth = normalizeDueDayOfMonth(body.dueDayOfMonth);

  if (!description) {
    return { error: "Template name is required" };
  }

  if (!category) {
    return { error: "Category is required" };
  }

  if (defaultAmount === null) {
    return { error: "Default amount must be greater than 0" };
  }

  if (defaultTaxAmount === null) {
    return { error: "Default tax amount must be 0 or greater" };
  }

  if (dueDayOfMonth === null) {
    return {
      error: `Due day must be between ${RECURRING_EXPENSE_MIN_DUE_DAY} and ${RECURRING_EXPENSE_MAX_DUE_DAY}`,
    };
  }

  const amountBreakdown = buildExpenseAmountBreakdown(
    defaultAmount,
    defaultTaxAmount,
  );

  if (!amountBreakdown) {
    return {
      error:
        "Default tax amount must be 0 or greater and cannot exceed the default total amount",
    };
  }

  return {
    payload: {
      category,
      default_amount: amountBreakdown.totalAmount,
      default_tax_amount: amountBreakdown.taxAmount,
      description,
      due_day_of_month: dueDayOfMonth,
      supplier_id: normalizeOptionalId(body.supplierId),
      vendor_name: normalizeOptionalString(body.vendorName),
      payment_method: normalizePaymentMethod(body.paymentMethod),
      notes: normalizeOptionalString(body.notes),
      active: normalizeActive(body.active),
    } satisfies ValidRecurringExpenseTemplatePayload,
  };
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
      "id,category,default_amount,default_tax_amount,description,due_day_of_month,supplier_id,vendor_name,payment_method,notes,active,created_by,updated_by,created_at,updated_at",
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
    const access = await requireExpenseManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as RecurringExpenseTemplateBody;
    const validation = validateTemplatePayload(body);

    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supplierValidation = await validateExpenseSupplierId(
      validation.payload.supplier_id,
      access,
    );

    if ("error" in supplierValidation) {
      return supplierValidation.error;
    }

    const payload: ValidRecurringExpenseTemplatePayload = {
      ...validation.payload,
      supplier_id: supplierValidation.supplierId,
      vendor_name:
        validation.payload.vendor_name ?? supplierValidation.supplierName,
    };
    const { data, error } = await access.supabase
      .from("recurring_expense_templates")
      .insert({
        ...payload,
        store_key: access.activeStoreKey,
        created_by: access.currentUser.id,
        updated_by: access.currentUser.id,
      })
      .select("id,description")
      .single<{ id: string; description: string }>();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create recurring template" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "expense_template",
      entityId: data.id,
      action: "expense_template.created",
      summary: `Recurring expense template created: ${payload.description}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        category: payload.category,
        defaultAmount: payload.default_amount,
        defaultTaxAmount: payload.default_tax_amount,
        dueDayOfMonth: payload.due_day_of_month,
        active: payload.active,
        supplierId: payload.supplier_id,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Recurring expense template creation error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create recurring template",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as RecurringExpenseTemplateBody;
    const id = getTemplateId(body);
    const loaded = await loadStoredTemplate(id);

    if ("error" in loaded) {
      return loaded.error;
    }

    const mergedBody: RecurringExpenseTemplateBody = {
      category: body.category ?? loaded.template.category,
      defaultAmount:
        body.defaultAmount ??
        (typeof loaded.template.default_amount === "number"
          ? loaded.template.default_amount
          : Number(loaded.template.default_amount)),
      defaultTaxAmount:
        body.defaultTaxAmount ??
        (typeof loaded.template.default_tax_amount === "number"
          ? loaded.template.default_tax_amount
          : Number(loaded.template.default_tax_amount ?? 0)),
      description: body.description ?? loaded.template.description,
      dueDayOfMonth: body.dueDayOfMonth ?? loaded.template.due_day_of_month,
      supplierId: body.supplierId ?? loaded.template.supplier_id ?? undefined,
      vendorName: body.vendorName ?? loaded.template.vendor_name ?? undefined,
      paymentMethod:
        body.paymentMethod ?? loaded.template.payment_method ?? undefined,
      notes: body.notes ?? loaded.template.notes ?? undefined,
      active: body.active ?? loaded.template.active ?? true,
    };

    const validation = validateTemplatePayload(mergedBody);

    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supplierValidation = await validateExpenseSupplierId(
      validation.payload.supplier_id,
      loaded.access,
    );

    if ("error" in supplierValidation) {
      return supplierValidation.error;
    }

    const payload: ValidRecurringExpenseTemplatePayload = {
      ...validation.payload,
      supplier_id: supplierValidation.supplierId,
      vendor_name:
        validation.payload.vendor_name ?? supplierValidation.supplierName,
    };
    const { data, error } = await loaded.access.supabase
      .from("recurring_expense_templates")
      .update({
        ...payload,
        updated_by: loaded.access.currentUser.id,
      })
      .eq("id", id)
      .eq("store_key", loaded.access.activeStoreKey)
      .select("id,description")
      .maybeSingle<{ id: string; description: string }>();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to update recurring template" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Recurring template not found" },
        { status: 404 },
      );
    }

    await appendAuditEvent({
      supabase: loaded.access.supabase,
      storeKey: loaded.access.activeStoreKey,
      entityType: "expense_template",
      entityId: data.id,
      action: "expense_template.updated",
      summary: `Recurring expense template updated: ${payload.description}`,
      actorId: loaded.access.currentUser.id,
      actorName: loaded.access.currentUserName,
      actorRole: loaded.access.currentUserRole ?? "employee",
      metadata: {
        category: payload.category,
        defaultAmount: payload.default_amount,
        defaultTaxAmount: payload.default_tax_amount,
        dueDayOfMonth: payload.due_day_of_month,
        active: payload.active,
        previousActive: loaded.template.active ?? true,
        supplierId: payload.supplier_id,
      },
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("Recurring expense template update error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update recurring template",
      },
      { status: 500 },
    );
  }
}
