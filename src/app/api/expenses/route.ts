import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { appendAuditEvent } from "@/lib/audit/events";
import { normalizeExpenseCategory } from "@/lib/expenses/categories";
import {
  requireExpenseManagerAccess,
  validateExpenseSupplierId,
} from "@/lib/expenses/api";
import {
  buildExpenseAmountBreakdown,
  findPotentialDuplicateExpenses,
  getExpenseAttachmentRequirementMessage,
  isExpenseAttachmentRequiredForApproval,
  type DuplicateExpenseMatch,
} from "@/lib/expenses/expense-records";
import { getExpenseDocumentsBucket } from "@/lib/supabase/env";
import {
  isAllowedInvoiceFile,
  MAX_INVOICE_UPLOAD_BYTES,
  sanitizeStorageFileName,
} from "@/lib/vendors/invoice-processing";
import type { ExpenseRecordStatus } from "@/types/erp.types";

export const runtime = "nodejs";

const ALLOWED_PAYMENT_METHODS = new Set([
  "cash",
  "card",
  "mobile",
  "bank_transfer",
  "check",
  "other",
]);

type ExpenseMutationBody = {
  id?: unknown;
  category?: unknown;
  amount?: unknown;
  taxAmount?: unknown;
  description?: unknown;
  supplierId?: unknown;
  vendorName?: unknown;
  paymentMethod?: unknown;
  notes?: unknown;
  status?: unknown;
  expenseDate?: unknown;
  reviewComment?: unknown;
  allowDuplicate?: unknown;
};

type ParsedExpenseRequest = {
  body: ExpenseMutationBody;
  attachment: File | null;
};

type ExpenseRecord = {
  id: string;
  description: string;
};

type ValidExpensePayload = {
  category: string;
  amount: number;
  subtotal_amount: number;
  tax_amount: number;
  description: string;
  supplier_id: string | null;
  vendor_name: string | null;
  payment_method: string | null;
  notes: string | null;
  status: ExpenseRecordStatus;
  expense_date: string;
};

type StoredExpenseRecord = ExpenseRecord & {
  category: string;
  amount: number | string;
  subtotal_amount: number | string;
  tax_amount: number | string;
  supplier_id: string | null;
  vendor_name: string | null;
  payment_method: string | null;
  notes: string | null;
  approval_note: string | null;
  void_note: string | null;
  attachment_name: string | null;
  attachment_path: string | null;
  attachment_url: string | null;
  attachment_mime_type: string | null;
  status: ExpenseRecordStatus;
  expense_date: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
};

type AccessContext = Awaited<ReturnType<typeof requireExpenseManagerAccess>>;
type ExpenseAccess = Exclude<AccessContext, { error: NextResponse }>;

type UploadedExpenseAttachment = {
  attachment_name: string;
  attachment_path: string;
  attachment_url: null;
  attachment_mime_type: string;
};

type LoadedExpenseResult =
  | {
      error: NextResponse;
    }
  | {
      access: ExpenseAccess;
      expense: StoredExpenseRecord;
      id: string;
    };

const MAX_EXPENSE_REVIEW_COMMENT_LENGTH = 1000;
const DUPLICATE_EXPENSE_CODE = "duplicate_expense";

type PotentialDuplicateExpenseRow = {
  id: string;
  description: string;
  category: string;
  amount: number | string;
  expense_date: string;
  status: ExpenseRecordStatus | null;
  supplier_id: string | null;
  vendor_name: string | null;
};

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function parsePayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as ExpenseMutationBody;
  } catch {
    return null;
  }
}

async function parseExpenseRequest(
  request: NextRequest,
): Promise<ParsedExpenseRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const attachmentEntry = formData.get("attachment");

    return {
      body: parsePayload(formData.get("payload")) ?? {},
      attachment:
        attachmentEntry instanceof File && attachmentEntry.size > 0
          ? attachmentEntry
          : null,
    };
  }

  return {
    body: (await request.json()) as ExpenseMutationBody,
    attachment: null,
  };
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

function normalizeBoolean(value: unknown) {
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

  return false;
}

function normalizeExpenseDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeStatus(value: unknown): ExpenseRecordStatus {
  if (value === "void") {
    return "void";
  }

  return value === "draft" ? "draft" : "approved";
}

function normalizePaymentMethod(value: unknown) {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  return normalized && ALLOWED_PAYMENT_METHODS.has(normalized)
    ? normalized
    : null;
}

function normalizeReviewComment(value: unknown) {
  if (value === undefined || value === null) {
    return { value: null };
  }

  if (typeof value !== "string") {
    return { error: "Review note must be text" };
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  if (normalized.length === 0) {
    return { value: null };
  }

  if (normalized.length > MAX_EXPENSE_REVIEW_COMMENT_LENGTH) {
    return {
      error: `Review note must be ${MAX_EXPENSE_REVIEW_COMMENT_LENGTH} characters or fewer`,
    };
  }

  return { value: normalized };
}

function addUtcDays(dateKey: string, dayDelta: number) {
  const [yearLabel, monthLabel, dayLabel] = dateKey.split("-");
  const year = Number(yearLabel);
  const month = Number(monthLabel);
  const day = Number(dayLabel);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return dateKey;
  }

  return new Date(Date.UTC(year, month - 1, day + dayDelta))
    .toISOString()
    .slice(0, 10);
}

function getExpenseId(body: ExpenseMutationBody) {
  return typeof body.id === "string" ? body.id.trim() : "";
}

function validateExpensePayload(body: ExpenseMutationBody) {
  const category = normalizeExpenseCategory(body.category);
  const description = normalizeOptionalString(body.description);
  const amount = normalizeAmount(body.amount);
  const rawTaxAmount =
    body.taxAmount === undefined || body.taxAmount === null || body.taxAmount === ""
      ? 0
      : normalizeNonNegativeAmount(body.taxAmount);
  const expenseDate = normalizeExpenseDate(body.expenseDate);

  if (!description) {
    return { error: "Expense name is required" };
  }

  if (!category) {
    return { error: "Category is required" };
  }

  if (amount === null) {
    return { error: "Amount must be greater than 0" };
  }

  if (rawTaxAmount === null) {
    return { error: "Tax amount must be 0 or greater" };
  }

  if (!expenseDate) {
    return { error: "Expense date is required" };
  }

  const amountBreakdown = buildExpenseAmountBreakdown(amount, rawTaxAmount);

  if (!amountBreakdown) {
    return {
      error: "Tax amount must be 0 or greater and cannot exceed the total amount",
    };
  }

  return {
    payload: {
      category,
      amount: amountBreakdown.totalAmount,
      subtotal_amount: amountBreakdown.subtotalAmount,
      tax_amount: amountBreakdown.taxAmount,
      description,
      supplier_id: normalizeOptionalId(body.supplierId),
      vendor_name: normalizeOptionalString(body.vendorName),
      payment_method: normalizePaymentMethod(body.paymentMethod),
      notes: normalizeOptionalString(body.notes),
      status: normalizeStatus(body.status),
      expense_date: expenseDate,
    },
  };
}

async function findDuplicateExpenseMatches(
  access: ExpenseAccess,
  payload: ValidExpensePayload,
  expenseId?: string,
) {
  const { data, error } = await access.supabase
    .from("expense_records")
    .select(
      "id,description,category,amount,expense_date,status,supplier_id,vendor_name",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("category", payload.category)
    .eq("amount", payload.amount)
    .gte("expense_date", addUtcDays(payload.expense_date, -7))
    .lte("expense_date", addUtcDays(payload.expense_date, 7))
    .in("status", ["draft", "approved"])
    .returns<PotentialDuplicateExpenseRow[]>();

  if (error) {
    return {
      error: NextResponse.json(
        { error: error.message ?? "Failed to inspect duplicate expenses" },
        { status: 500 },
      ),
    };
  }

  return {
    duplicates: findPotentialDuplicateExpenses(
      {
        expenseId,
        description: payload.description,
        category: payload.category,
        amount: payload.amount,
        expenseDate: payload.expense_date,
        supplierId: payload.supplier_id,
        vendorName: payload.vendor_name,
      },
      (data ?? []).map((expense) => ({
        id: expense.id,
        description: expense.description,
        category: expense.category,
        amount:
          typeof expense.amount === "number"
            ? expense.amount
            : Number(expense.amount),
        date: expense.expense_date,
        status: expense.status ?? "approved",
        supplierId: expense.supplier_id,
        vendorName: expense.vendor_name,
      })),
    ),
  };
}

function buildDuplicateExpenseResponse(duplicates: DuplicateExpenseMatch[]) {
  return NextResponse.json(
    {
      error:
        "A similar expense already exists for this store. Review the matching entries before saving again.",
      code: DUPLICATE_EXPENSE_CODE,
      duplicates,
    },
    { status: 409 },
  );
}

function validateAttachmentFile(file: File) {
  if (file.size <= 0) {
    return "Bill copy file is empty";
  }

  if (file.size > MAX_INVOICE_UPLOAD_BYTES) {
    return "Bill copy file must be 10MB or smaller";
  }

  if (!isAllowedInvoiceFile(file.name, file.type)) {
    return "Upload a PDF, PNG, JPG, or WEBP bill copy";
  }

  return null;
}

async function uploadExpenseAttachment(
  access: ExpenseAccess,
  file: File,
  expenseDate: string,
) {
  const validationError = validateAttachmentFile(file);

  if (validationError) {
    return { error: validationError, status: 400 as const };
  }

  const bucket = getExpenseDocumentsBucket();
  const storagePath = `expenses/${access.activeStoreKey}/${access.currentUser.id}/${expenseDate}/${randomUUID()}-${sanitizeStorageFileName(file.name)}`;
  const { error } = await access.supabase.storage
    .from(bucket)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || "application/pdf",
      upsert: false,
    });

  if (error) {
    const isMissingBucket =
      error.message?.toLowerCase().includes("bucket") &&
      error.message?.toLowerCase().includes("not found");

    return {
      error: isMissingBucket
        ? "Expense document storage bucket is missing. Apply the latest Supabase migrations first."
        : (error.message ?? "Failed to upload bill copy"),
      status: isMissingBucket ? 503 : 500,
    };
  }

  return {
    data: {
      attachment_name: file.name,
      attachment_path: storagePath,
      attachment_url: null,
      attachment_mime_type: file.type || "application/pdf",
    } satisfies UploadedExpenseAttachment,
  };
}

async function removeExpenseAttachment(
  access: ExpenseAccess,
  attachmentPath: string | null | undefined,
) {
  if (!attachmentPath) {
    return;
  }

  const bucket = getExpenseDocumentsBucket();
  await access.supabase.storage.from(bucket).remove([attachmentPath]);
}

function buildDraftPayload() {
  return {
    status: "draft" as const,
    approved_at: null,
    approved_by: null,
    approval_note: null,
    voided_at: null,
    voided_by: null,
    void_note: null,
  };
}

function buildApprovedPayload(
  currentUserId: string,
  reviewComment: string | null,
) {
  return {
    status: "approved" as const,
    approved_at: new Date().toISOString(),
    approved_by: currentUserId,
    approval_note: reviewComment,
    voided_at: null,
    voided_by: null,
    void_note: null,
  };
}

function buildVoidedPayload(
  currentUserId: string,
  reviewComment: string | null,
) {
  return {
    status: "void" as const,
    voided_at: new Date().toISOString(),
    voided_by: currentUserId,
    void_note: reviewComment,
  };
}

function hasExpenseValueChanges(
  expense: StoredExpenseRecord,
  payload: ValidExpensePayload,
) {
  return (
    expense.category !== payload.category ||
    Number(expense.amount) !== payload.amount ||
    Number(expense.subtotal_amount) !== payload.subtotal_amount ||
    Number(expense.tax_amount) !== payload.tax_amount ||
    expense.description !== payload.description ||
    (expense.supplier_id ?? null) !== payload.supplier_id ||
    (expense.vendor_name ?? null) !== payload.vendor_name ||
    (expense.payment_method ?? null) !== payload.payment_method ||
    (expense.notes ?? null) !== payload.notes ||
    expense.expense_date !== payload.expense_date
  );
}

async function loadStoredExpense(
  body: ExpenseMutationBody,
): Promise<LoadedExpenseResult> {
  const access = await requireExpenseManagerAccess();

  if ("error" in access) {
    return {
      error:
        access.error ??
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const id = getExpenseId(body);

  if (!id) {
    return {
      error: NextResponse.json(
        { error: "Expense id is required" },
        { status: 400 },
      ),
    };
  }

  const { data, error } = await access.supabase
    .from("expense_records")
    .select(
      "id,description,category,amount,subtotal_amount,tax_amount,supplier_id,vendor_name,payment_method,notes,approval_note,void_note,attachment_name,attachment_path,attachment_url,attachment_mime_type,status,expense_date,created_by,approved_by,approved_at,voided_by,voided_at",
    )
    .eq("id", id)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<StoredExpenseRecord>();

  if (error) {
    return {
      error: NextResponse.json(
        { error: error.message ?? "Failed to load expense" },
        { status: 500 },
      ),
    };
  }

  if (!data) {
    return {
      error: NextResponse.json({ error: "Expense not found" }, { status: 404 }),
    };
  }

  return {
    access,
    expense: data,
    id,
  };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireExpenseManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const parsedRequest = await parseExpenseRequest(request);
    const validation = validateExpensePayload(parsedRequest.body);

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

    const payload: ValidExpensePayload = {
      ...validation.payload,
      supplier_id: supplierValidation.supplierId,
      vendor_name:
        validation.payload.vendor_name ?? supplierValidation.supplierName,
    };
    const allowDuplicate = normalizeBoolean(parsedRequest.body.allowDuplicate);

    if (payload.status === "approved") {
      return NextResponse.json(
        {
          error:
            "New expenses must be saved as draft. Another manager or owner must approve them.",
        },
        { status: 409 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      payload.expense_date,
      `Expense ${payload.description}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    let uploadedAttachment: UploadedExpenseAttachment | null = null;

    if (parsedRequest.attachment) {
      const uploadResult = await uploadExpenseAttachment(
        access,
        parsedRequest.attachment,
        payload.expense_date,
      );

      if ("error" in uploadResult) {
        return NextResponse.json(
          { error: uploadResult.error },
          { status: uploadResult.status },
        );
      }

      uploadedAttachment = uploadResult.data;
    }

    if (!allowDuplicate) {
      const duplicateResult = await findDuplicateExpenseMatches(access, payload);

      if ("error" in duplicateResult) {
        if (uploadedAttachment?.attachment_path) {
          await removeExpenseAttachment(
            access,
            uploadedAttachment.attachment_path,
          );
        }

        return duplicateResult.error;
      }

      if (duplicateResult.duplicates.length > 0) {
        if (uploadedAttachment?.attachment_path) {
          await removeExpenseAttachment(
            access,
            uploadedAttachment.attachment_path,
          );
        }

        return buildDuplicateExpenseResponse(duplicateResult.duplicates);
      }
    }

    const { data, error } = await access.supabase
      .from("expense_records")
      .insert({
        ...payload,
        ...buildDraftPayload(),
        ...(uploadedAttachment ?? {}),
        created_by: access.currentUser.id,
        store_key: access.activeStoreKey,
      })
      .select("id,description")
      .single<ExpenseRecord>();

    if (error || !data) {
      await removeExpenseAttachment(
        access,
        uploadedAttachment?.attachment_path,
      );

      return NextResponse.json(
        { error: error?.message ?? "Failed to create expense" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "expense",
      entityId: data.id,
      action: "expense.drafted",
      summary: `Draft expense created: ${payload.description}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole ?? "employee",
      metadata: {
        category: payload.category,
        amount: payload.amount,
        subtotalAmount: payload.subtotal_amount,
        taxAmount: payload.tax_amount,
        supplierId: payload.supplier_id,
        expenseDate: payload.expense_date,
        attachmentName: uploadedAttachment?.attachment_name ?? null,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Expense creation error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create expense",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const parsedRequest = await parseExpenseRequest(request);
    const body = parsedRequest.body;
    const loaded = await loadStoredExpense(body);

    if ("error" in loaded) {
      return loaded.error;
    }

    const mergedBody: ExpenseMutationBody = {
      category: body.category ?? loaded.expense.category,
      amount:
        body.amount ??
        (typeof loaded.expense.amount === "number"
          ? loaded.expense.amount
          : Number(loaded.expense.amount)),
      taxAmount:
        body.taxAmount ??
        (typeof loaded.expense.tax_amount === "number"
          ? loaded.expense.tax_amount
          : Number(loaded.expense.tax_amount)),
      description: body.description ?? loaded.expense.description,
      supplierId: body.supplierId ?? loaded.expense.supplier_id ?? undefined,
      vendorName: body.vendorName ?? loaded.expense.vendor_name ?? undefined,
      paymentMethod:
        body.paymentMethod ?? loaded.expense.payment_method ?? undefined,
      notes: body.notes ?? loaded.expense.notes ?? undefined,
      status: body.status ?? loaded.expense.status,
      expenseDate: body.expenseDate ?? loaded.expense.expense_date,
    };

    const validation = validateExpensePayload(mergedBody);

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

    const payload: ValidExpensePayload = {
      ...validation.payload,
      supplier_id: supplierValidation.supplierId,
      vendor_name:
        validation.payload.vendor_name ?? supplierValidation.supplierName,
    };
    const reviewCommentResult = normalizeReviewComment(body.reviewComment);

    if ("error" in reviewCommentResult) {
      return NextResponse.json(
        { error: reviewCommentResult.error },
        { status: 400 },
      );
    }

    const requestedStatus = normalizeStatus(
      body.status ?? loaded.expense.status,
    );
    const reviewComment = reviewCommentResult.value;
    const hasValueChanges = hasExpenseValueChanges(loaded.expense, payload);
    const hasAttachmentReplacement = Boolean(parsedRequest.attachment);
    const isApprovalRequest = requestedStatus === "approved";
    const isVoidRequest = requestedStatus === "void";
    const allowDuplicate = normalizeBoolean(body.allowDuplicate);

    if (loaded.expense.status === "void") {
      return NextResponse.json(
        { error: "Voided expenses are read-only for audit purposes" },
        { status: 409 },
      );
    }

    if (
      loaded.expense.status === "approved" &&
      !isVoidRequest &&
      (hasValueChanges || hasAttachmentReplacement)
    ) {
      return NextResponse.json(
        {
          error:
            "Approved expenses cannot be edited. Void the record and create a replacement draft instead.",
        },
        { status: 409 },
      );
    }

    if (isApprovalRequest) {
      if (loaded.expense.status !== "draft") {
        return NextResponse.json(
          { error: "Only draft expenses can be approved" },
          { status: 409 },
        );
      }

      if (loaded.expense.created_by === loaded.access.currentUser.id) {
        return NextResponse.json(
          {
            error:
              "The user who created this expense cannot approve it. Another manager or owner must review it.",
          },
          { status: 409 },
        );
      }
    }

    if (isVoidRequest && (hasValueChanges || hasAttachmentReplacement)) {
      return NextResponse.json(
        {
          error:
            "Voiding an expense cannot change its amount, details, or bill copy.",
        },
        { status: 409 },
      );
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      loaded.access.supabase,
      loaded.access.activeStoreKey,
      isVoidRequest ? loaded.expense.expense_date : payload.expense_date,
      `Expense ${payload.description}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    let uploadedAttachment: UploadedExpenseAttachment | null = null;

    if (parsedRequest.attachment) {
      const uploadResult = await uploadExpenseAttachment(
        loaded.access,
        parsedRequest.attachment,
        payload.expense_date,
      );

      if ("error" in uploadResult) {
        return NextResponse.json(
          { error: uploadResult.error },
          { status: uploadResult.status },
        );
      }

      uploadedAttachment = uploadResult.data;
    }

    const hasAttachment =
      Boolean(uploadedAttachment?.attachment_path) ||
      Boolean(loaded.expense.attachment_path) ||
      Boolean(loaded.expense.attachment_url);

    if (
      isApprovalRequest &&
      isExpenseAttachmentRequiredForApproval({
        category: payload.category,
        amount: payload.amount,
      }) &&
      !hasAttachment
    ) {
      if (uploadedAttachment?.attachment_path) {
        await removeExpenseAttachment(
          loaded.access,
          uploadedAttachment.attachment_path,
        );
      }

      return NextResponse.json(
        {
          error: getExpenseAttachmentRequirementMessage({
            category: payload.category,
            amount: payload.amount,
          }),
        },
        { status: 409 },
      );
    }

    if (!allowDuplicate && !isApprovalRequest && !isVoidRequest) {
      const duplicateResult = await findDuplicateExpenseMatches(
        loaded.access,
        payload,
        loaded.id,
      );

      if ("error" in duplicateResult) {
        if (uploadedAttachment?.attachment_path) {
          await removeExpenseAttachment(
            loaded.access,
            uploadedAttachment.attachment_path,
          );
        }

        return duplicateResult.error;
      }

      if (duplicateResult.duplicates.length > 0) {
        if (uploadedAttachment?.attachment_path) {
          await removeExpenseAttachment(
            loaded.access,
            uploadedAttachment.attachment_path,
          );
        }

        return buildDuplicateExpenseResponse(duplicateResult.duplicates);
      }
    }

    const statusPayload = isVoidRequest
      ? buildVoidedPayload(loaded.access.currentUser.id, reviewComment)
      : isApprovalRequest
        ? buildApprovedPayload(loaded.access.currentUser.id, reviewComment)
        : buildDraftPayload();

    const { data, error } = await loaded.access.supabase
      .from("expense_records")
      .update({
        ...payload,
        ...statusPayload,
        ...(uploadedAttachment ?? {}),
      })
      .eq("id", loaded.id)
      .eq("store_key", loaded.access.activeStoreKey)
      .select("id,description")
      .maybeSingle<ExpenseRecord>();

    if (error) {
      await removeExpenseAttachment(
        loaded.access,
        uploadedAttachment?.attachment_path,
      );

      return NextResponse.json(
        { error: error.message ?? "Failed to update expense" },
        { status: 500 },
      );
    }

    if (!data) {
      await removeExpenseAttachment(
        loaded.access,
        uploadedAttachment?.attachment_path,
      );

      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    if (uploadedAttachment?.attachment_path) {
      await removeExpenseAttachment(
        loaded.access,
        loaded.expense.attachment_path,
      );
    }

    await appendAuditEvent({
      supabase: loaded.access.supabase,
      storeKey: loaded.access.activeStoreKey,
      entityType: "expense",
      entityId: data.id,
      action: isVoidRequest
        ? "expense.voided"
        : isApprovalRequest
          ? "expense.approved"
          : "expense.updated",
      summary: isVoidRequest
        ? `Expense voided: ${payload.description}`
        : isApprovalRequest
          ? `Expense approved: ${payload.description}`
          : `Draft expense updated: ${payload.description}`,
      actorId: loaded.access.currentUser.id,
      actorName: loaded.access.currentUserName,
      actorRole: loaded.access.currentUserRole ?? "employee",
      metadata: {
        category: payload.category,
        amount: payload.amount,
        subtotalAmount: payload.subtotal_amount,
        taxAmount: payload.tax_amount,
        supplierId: payload.supplier_id,
        expenseDate: payload.expense_date,
        attachmentName:
          uploadedAttachment?.attachment_name ??
          loaded.expense.attachment_name ??
          null,
        previousStatus: loaded.expense.status,
        nextStatus: statusPayload.status,
        reviewComment:
          isApprovalRequest || isVoidRequest ? reviewComment : null,
      },
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("Expense update error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update expense",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    const loaded = await loadStoredExpense({ id });

    if ("error" in loaded) {
      return loaded.error;
    }

    const periodLock = await assertAccountingPeriodUnlocked(
      loaded.access.supabase,
      loaded.access.activeStoreKey,
      loaded.expense.expense_date,
      `Expense ${loaded.expense.description}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }

    if (loaded.expense.status === "void") {
      return NextResponse.json({ success: true, id: loaded.id });
    }

    const { data, error } = await loaded.access.supabase
      .from("expense_records")
      .update(buildVoidedPayload(loaded.access.currentUser.id, null))
      .eq("id", loaded.id)
      .eq("store_key", loaded.access.activeStoreKey)
      .select("id,description")
      .maybeSingle<ExpenseRecord>();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to void expense" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    await appendAuditEvent({
      supabase: loaded.access.supabase,
      storeKey: loaded.access.activeStoreKey,
      entityType: "expense",
      entityId: data.id,
      action: "expense.voided",
      summary: `Expense voided: ${loaded.expense.description}`,
      actorId: loaded.access.currentUser.id,
      actorName: loaded.access.currentUserName,
      actorRole: loaded.access.currentUserRole ?? "employee",
      metadata: {
        previousStatus: loaded.expense.status,
        expenseDate: loaded.expense.expense_date,
      },
    });

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Expense delete error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to void expense",
      },
      { status: 500 },
    );
  }
}
