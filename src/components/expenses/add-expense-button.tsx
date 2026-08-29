"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { CurrencyInput } from "@/components/ui/currency-input";
import { VendorAttachmentActions } from "@/components/vendors/vendor-attachment-actions";
import { useStore } from "@/contexts/StoreContext";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenses/categories";
import {
  getExpenseAttachmentRequirementMessage,
  isExpenseAttachmentRequiredForApproval,
} from "@/lib/expenses/expense-records";
import { INVOICE_UPLOAD_ACCEPT } from "@/lib/vendors/invoice-processing";
import type { ExpenseRecordStatus } from "@/types/erp.types";

type ExpenseSupplierOption = {
  id: string;
  name: string;
};

export type EditableExpenseRecord = {
  id: string;
  category: string;
  amount: number;
  subtotalAmount: number;
  taxAmount: number;
  description: string;
  expenseDate: string;
  supplierId?: string;
  vendorName: string;
  paymentMethod: string;
  notes: string;
  status: ExpenseRecordStatus;
  attachmentName?: string;
  attachmentUrl?: string;
  attachmentDownloadUrl?: string;
};

type ExpenseFormState = {
  category: string;
  amount: string;
  taxAmount: string;
  description: string;
  expenseDate: string;
  supplierId: string;
  vendorName: string;
  paymentMethod: string;
  notes: string;
  status: ExpenseRecordStatus;
};

type AddExpenseButtonProps = {
  disabled?: boolean;
  expense?: EditableExpenseRecord;
  defaultExpenseDate?: string;
  buttonLabel?: string;
  tone?: "primary" | "secondary";
  iconOnly?: boolean;
  supplierOptions?: ExpenseSupplierOption[];
};

type DuplicateExpenseConflict = {
  duplicates: Array<{
    id: string;
    description: string;
    category: string;
    amount: number;
    expenseDate: string;
    status: ExpenseRecordStatus;
    vendorName?: string;
  }>;
};

const INPUT_CLASSNAME = "app-input";
function getTodayDateValue(timeZone = "UTC") {
  return getTodayIsoDateInTimeZone(timeZone);
}

function getInitialFormState(
  expense?: EditableExpenseRecord,
  defaultExpenseDate?: string,
): ExpenseFormState {
  if (!expense) {
    return {
      category: "",
      amount: "",
      taxAmount: "",
      description: "",
      expenseDate: defaultExpenseDate ?? getTodayDateValue(),
      supplierId: "",
      vendorName: "",
      paymentMethod: "",
      notes: "",
      status: "draft",
    };
  }

  return {
    category: expense.category,
    amount: expense.amount.toFixed(2),
    taxAmount: expense.taxAmount > 0 ? expense.taxAmount.toFixed(2) : "",
    description: expense.description,
    expenseDate: expense.expenseDate,
    supplierId: expense.supplierId ?? "",
    vendorName: expense.vendorName,
    paymentMethod: expense.paymentMethod,
    notes: expense.notes,
    status: expense.status,
  };
}

function getButtonClassName(tone: AddExpenseButtonProps["tone"]) {
  if (tone === "secondary") {
    return "app-secondary-button-sm disabled:cursor-not-allowed disabled:opacity-60";
  }

  return "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300";
}

export function AddExpenseButton({
  disabled = false,
  expense,
  defaultExpenseDate,
  buttonLabel,
  tone = "primary",
  iconOnly = false,
  supplierOptions = [],
}: AddExpenseButtonProps) {
  const router = useRouter();
  const { activeStore } = useStore();
  const resolvedDefaultExpenseDate =
    defaultExpenseDate ?? getTodayDateValue(activeStore?.timeZone);
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState<ExpenseFormState>(
    getInitialFormState(expense, resolvedDefaultExpenseDate),
  );
  const [attachment, setAttachment] = useState<File | null>(null);
  const [duplicateConflict, setDuplicateConflict] =
    useState<DuplicateExpenseConflict | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = Boolean(expense);
  const categoryOptions = expense?.category
    ? Array.from(new Set([...EXPENSE_CATEGORY_OPTIONS, expense.category]))
    : EXPENSE_CATEGORY_OPTIONS;

  const openModal = () => {
    setFormState(getInitialFormState(expense, resolvedDefaultExpenseDate));
    setAttachment(null);
    setDuplicateConflict(null);
    setError("");
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setFormState(getInitialFormState(expense, resolvedDefaultExpenseDate));
    setAttachment(null);
    setDuplicateConflict(null);
    setError("");
    setIsSubmitting(false);
  };

  const updateFormField = <K extends keyof ExpenseFormState>(
    key: K,
    value: ExpenseFormState[K],
  ) => {
    setDuplicateConflict(null);
    setFormState((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const selectedSupplier =
    supplierOptions.find((supplier) => supplier.id === formState.supplierId) ??
    null;
  const amountValue = Number(formState.amount);
  const taxAmountValue = Number(formState.taxAmount || 0);
  const hasValidAmount = Number.isFinite(amountValue) && amountValue > 0;
  const hasValidTaxAmount =
    formState.taxAmount.trim().length === 0 ||
    (Number.isFinite(taxAmountValue) && taxAmountValue >= 0);
  const subtotalValue =
    hasValidAmount && hasValidTaxAmount && taxAmountValue <= amountValue
      ? Math.round((amountValue - taxAmountValue) * 100) / 100
      : null;
  const requiresAttachmentOnApproval =
    hasValidAmount &&
    isExpenseAttachmentRequiredForApproval({
      category: formState.category,
      amount: amountValue,
    });
  const attachmentRequirementMessage =
    requiresAttachmentOnApproval && hasValidAmount
      ? getExpenseAttachmentRequirementMessage({
          category: formState.category,
          amount: amountValue,
        })
      : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const requestBody = new FormData();
        requestBody.set(
          "payload",
          JSON.stringify(
            isEditing
              ? {
                  id: expense?.id,
                  allowDuplicate: Boolean(duplicateConflict),
                  ...formState,
                }
              : {
                  allowDuplicate: Boolean(duplicateConflict),
                  ...formState,
                },
          ),
        );

        if (attachment) {
          requestBody.set("attachment", attachment);
        }

        const response = await fetch("/api/expenses", {
          method: isEditing ? "PATCH" : "POST",
          body: requestBody,
        });
        const body = (await response.json()) as
          | { id: string; description: string }
          | {
              error?: string;
              code?: string;
              duplicates?: DuplicateExpenseConflict["duplicates"];
            };

        if (!response.ok || ("error" in body && body.error)) {
          if (
            "code" in body &&
            body.code === "duplicate_expense" &&
            Array.isArray(body.duplicates)
          ) {
            setDuplicateConflict({ duplicates: body.duplicates });
            throw new Error(
              body.error ?? "A similar expense already exists for this store.",
            );
          }

          throw new Error(
            "error" in body && body.error
              ? body.error
              : isEditing
                ? "Failed to update expense"
                : "Failed to add expense",
          );
        }

        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : isEditing
              ? "Failed to update expense"
              : "Failed to add expense",
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={disabled}
        className={
          iconOnly
            ? "app-icon-button app-icon-button-accent disabled:cursor-not-allowed disabled:opacity-60"
            : getButtonClassName(tone)
        }
        title={
          disabled
            ? "Supabase must be configured to manage expenses."
            : isEditing
              ? "Edit expense"
              : "Add expense"
        }
        aria-label={isEditing ? "Edit expense" : "Add expense"}
      >
        {isEditing ? (
          <Pencil className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {iconOnly
          ? null
          : (buttonLabel ?? (isEditing ? "Edit" : "Add expense"))}
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    {isEditing ? "Edit expense" : "Add expense"}
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {isEditing
                      ? "Update this draft expense before it moves into approval."
                      : "Log a store expense as a draft. A different manager or owner must approve it before it affects net profit."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label={
                    isEditing
                      ? "Close edit expense dialog"
                      : "Close add expense dialog"
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Expense name
                    </label>
                    <input
                      required
                      value={formState.description}
                      onChange={(event) =>
                        updateFormField("description", event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Electric bill - April"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Category
                    </label>
                    <select
                      required
                      value={formState.category}
                      onChange={(event) =>
                        updateFormField("category", event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                    >
                      <option value="">Select category</option>
                      {categoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      Use{" "}
                      <span className="font-medium text-dark dark:text-white">
                        Utilities
                      </span>{" "}
                      for power, water, internet, gas, trash, and similar store
                      bills.
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Amount
                    </label>
                    <CurrencyInput
                      required
                      value={formState.amount}
                      onValueChange={(decimalValue) =>
                        updateFormField("amount", decimalValue)
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Tax amount
                    </label>
                    <CurrencyInput
                      value={formState.taxAmount}
                      onValueChange={(decimalValue) =>
                        updateFormField("taxAmount", decimalValue)
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.00"
                    />
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      {subtotalValue === null
                        ? "Tax cannot exceed the total amount."
                        : `Subtotal before tax: $${subtotalValue.toFixed(2)}`}
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Expense date
                    </label>
                    <input
                      required
                      type="date"
                      value={formState.expenseDate}
                      onChange={(event) =>
                        updateFormField("expenseDate", event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Linked vendor
                    </label>
                    <select
                      value={formState.supplierId}
                      onChange={(event) => {
                        const supplierId = event.target.value;
                        const supplier =
                          supplierOptions.find(
                            (item) => item.id === supplierId,
                          ) ?? null;
                        setDuplicateConflict(null);
                        setFormState((current) => ({
                          ...current,
                          supplierId,
                          vendorName: supplier?.name ?? current.vendorName,
                        }));
                      }}
                      className={INPUT_CLASSNAME}
                    >
                      <option value="">No linked vendor</option>
                      {supplierOptions.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payee or vendor
                    </label>
                    <input
                      value={formState.vendorName}
                      onChange={(event) =>
                        updateFormField("vendorName", event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Landlord, utility company, etc."
                    />
                    {selectedSupplier ? (
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        Linked vendor record: {selectedSupplier.name}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payment method
                    </label>
                    <select
                      value={formState.paymentMethod}
                      onChange={(event) =>
                        updateFormField("paymentMethod", event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                    >
                      <option value="">Not specified</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="mobile">Mobile</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="check">Check</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Workflow
                    </label>
                    <select
                      value={formState.status}
                      onChange={() => undefined}
                      className={INPUT_CLASSNAME}
                      disabled
                    >
                      <option value="draft">Draft</option>
                    </select>
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      Draft expenses stay out of net profit until another
                      reviewer approves them.
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Bill copy or receipt
                    </label>
                    <input
                      type="file"
                      accept={INVOICE_UPLOAD_ACCEPT}
                      onChange={(event) =>
                        setAttachment(event.target.files?.[0] ?? null)
                      }
                      className={INPUT_CLASSNAME}
                    />
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      Optional utility bill, invoice, receipt, or statement
                      copy. Max 10MB.
                    </p>
                    {attachmentRequirementMessage ? (
                      <p className="mt-2 text-xs font-medium text-amber-700">
                        {attachmentRequirementMessage}
                      </p>
                    ) : null}
                    {attachment ? (
                      <div className="mt-2 text-xs font-medium text-dark dark:text-white">
                        Selected: {attachment.name}
                      </div>
                    ) : expense?.attachmentUrl ? (
                      <div className="mt-3">
                        <VendorAttachmentActions
                          href={expense.attachmentUrl}
                          downloadHref={expense.attachmentDownloadUrl}
                          kindHint={expense.attachmentName}
                          label={expense.attachmentName ?? "Current bill copy"}
                          title="Expense document"
                        />
                        <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                          Upload a new file to replace the current copy when you
                          save this draft.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Notes
                    </label>
                    <textarea
                      rows={4}
                      value={formState.notes}
                      onChange={(event) =>
                        updateFormField("notes", event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Optional context for this expense entry."
                    />
                  </div>
                </div>

                {duplicateConflict ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <div className="font-semibold">
                      Similar expense already exists
                    </div>
                    <div className="mt-1">
                      Review the matching entries below. Submit again to save
                      this draft anyway.
                    </div>
                    <div className="mt-3 space-y-2 text-xs">
                      {duplicateConflict.duplicates.map((duplicate) => (
                        <div
                          key={duplicate.id}
                          className="rounded-xl border border-amber-200 bg-white px-3 py-2"
                        >
                          <div className="font-medium text-dark">
                            {duplicate.description}
                          </div>
                          <div className="mt-1 text-dark-5">
                            {duplicate.expenseDate} · {duplicate.category} · $
                            {duplicate.amount.toFixed(2)} · {duplicate.status}
                            {duplicate.vendorName
                              ? ` · ${duplicate.vendorName}`
                              : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-4 rounded-2xl border border-red/20 bg-red/5 px-4 py-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
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
                    {duplicateConflict
                      ? isEditing
                        ? "Save anyway"
                        : "Create anyway"
                      : isEditing
                        ? "Save draft"
                        : "Create draft"}
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
