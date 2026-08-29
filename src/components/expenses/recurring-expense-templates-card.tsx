"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
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
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenses/categories";
import { formatRecurringExpenseMonthLabel } from "@/lib/expenses/recurring";
import type {
  ExpenseRecord,
  RecurringExpenseTemplate,
} from "@/types/erp.types";

const INPUT_CLASSNAME = "app-input";

type RecurringExpenseTemplatesCardProps = {
  templates: RecurringExpenseTemplate[];
  expenses: ExpenseRecord[];
  canManageExpenses: boolean;
  currentMonthKey: string;
};

type TemplateFormState = {
  category: string;
  defaultAmount: string;
  description: string;
  dueDayOfMonth: string;
  vendorName: string;
  paymentMethod: string;
  notes: string;
  active: boolean;
};

const CURRENT_MONTH_LABEL = "Current month";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function toIsoDateKey(value: Date | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function getTemplateExpenseKey(templateId: string, monthKey: string) {
  return `${templateId}:${monthKey}`;
}

function getInitialFormState(
  template?: RecurringExpenseTemplate | null,
): TemplateFormState {
  return {
    category: template?.category ?? "",
    defaultAmount: template ? template.defaultAmount.toFixed(2) : "",
    description: template?.description ?? "",
    dueDayOfMonth: template ? String(template.dueDayOfMonth) : "1",
    vendorName: template?.vendorName ?? "",
    paymentMethod: template?.paymentMethod ?? "",
    notes: template?.notes ?? "",
    active: template?.active ?? true,
  };
}

function getCurrentMonthTone(
  template: RecurringExpenseTemplate,
  expense: ExpenseRecord | null,
) {
  if (expense) {
    if (expense.status === "approved") {
      return "green" as const;
    }

    if (expense.status === "void") {
      return "slate" as const;
    }

    return "amber" as const;
  }

  return template.active ? ("blue" as const) : ("slate" as const);
}

function getCurrentMonthLabel(
  template: RecurringExpenseTemplate,
  expense: ExpenseRecord | null,
) {
  if (expense) {
    if (expense.status === "approved") {
      return "Approved";
    }

    if (expense.status === "void") {
      return "Voided";
    }

    return "Draft created";
  }

  return template.active ? "Ready" : "Paused";
}

export function RecurringExpenseTemplatesCard({
  templates,
  expenses,
  canManageExpenses,
  currentMonthKey,
}: RecurringExpenseTemplatesCardProps) {
  const router = useRouter();
  const { success: notifySuccess, error: notifyError } = useAppNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<RecurringExpenseTemplate | null>(null);
  const [formState, setFormState] = useState<TemplateFormState>(
    getInitialFormState(),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatingTemplateId, setGeneratingTemplateId] = useState<
    string | null
  >(null);
  const currentMonthLabel = formatRecurringExpenseMonthLabel(currentMonthKey);

  const recurringExpenses = useMemo(
    () =>
      expenses
        .filter(
          (expense) =>
            Boolean(expense.recurringTemplateId) &&
            Boolean(expense.recurringPeriodMonth),
        )
        .sort(
          (left, right) =>
            (right.recurringPeriodMonth?.getTime() ?? right.date.getTime()) -
              (left.recurringPeriodMonth?.getTime() ?? left.date.getTime()) ||
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            right.createdAt.getTime() - left.createdAt.getTime(),
        ),
    [expenses],
  );

  const currentMonthExpenseByTemplate = useMemo(() => {
    const lookup = new Map<string, ExpenseRecord>();

    for (const expense of recurringExpenses) {
      const recurringTemplateId = expense.recurringTemplateId;
      const recurringPeriodMonth = toIsoDateKey(expense.recurringPeriodMonth);

      if (!recurringTemplateId || !recurringPeriodMonth) {
        continue;
      }

      if (recurringPeriodMonth !== currentMonthKey) {
        continue;
      }

      const key = getTemplateExpenseKey(
        recurringTemplateId,
        recurringPeriodMonth,
      );
      const existing = lookup.get(key);

      if (!existing) {
        lookup.set(key, expense);
        continue;
      }

      if (existing.status === "void" && expense.status !== "void") {
        lookup.set(key, expense);
      }
    }

    return lookup;
  }, [currentMonthKey, recurringExpenses]);

  const latestExpenseByTemplate = useMemo(() => {
    const lookup = new Map<string, ExpenseRecord>();

    for (const expense of recurringExpenses) {
      const recurringTemplateId = expense.recurringTemplateId;

      if (!recurringTemplateId) {
        continue;
      }

      if (!lookup.has(recurringTemplateId)) {
        lookup.set(recurringTemplateId, expense);
      }
    }

    return lookup;
  }, [recurringExpenses]);

  const activeTemplateCount = templates.filter(
    (template) => template.active,
  ).length;
  const readyTemplateCount = templates.filter((template) => {
    if (!template.active) {
      return false;
    }

    const currentMonthExpense =
      currentMonthExpenseByTemplate.get(
        getTemplateExpenseKey(template.id, currentMonthKey),
      ) ?? null;

    return !currentMonthExpense || currentMonthExpense.status === "void";
  }).length;
  const currentMonthCreatedCount = templates.filter((template) => {
    const currentMonthExpense =
      currentMonthExpenseByTemplate.get(
        getTemplateExpenseKey(template.id, currentMonthKey),
      ) ?? null;

    return Boolean(
      currentMonthExpense &&
        (currentMonthExpense.status === "draft" ||
          currentMonthExpense.status === "approved"),
    );
  }).length;

  const openCreateModal = () => {
    setEditingTemplate(null);
    setFormState(getInitialFormState());
    setError("");
    setIsOpen(true);
  };

  const openEditModal = (template: RecurringExpenseTemplate) => {
    setEditingTemplate(template);
    setFormState(getInitialFormState(template));
    setError("");
    setIsOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) {
      return;
    }

    setEditingTemplate(null);
    setFormState(getInitialFormState());
    setError("");
    setIsOpen(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const payload = {
          id: editingTemplate?.id,
          category: formState.category,
          defaultAmount: formState.defaultAmount,
          description: formState.description,
          dueDayOfMonth: formState.dueDayOfMonth,
          vendorName: formState.vendorName,
          paymentMethod: formState.paymentMethod,
          notes: formState.notes,
          active: formState.active,
        };
        const response = await fetch("/api/expenses/recurring", {
          method: editingTemplate ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(
            body.error ??
              (editingTemplate
                ? "Failed to update recurring template"
                : "Failed to create recurring template"),
          );
        }

        notifySuccess(
          editingTemplate
            ? "Recurring template updated"
            : "Recurring template created",
        );
        closeModal();
        router.refresh();
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : editingTemplate
              ? "Failed to update recurring template"
              : "Failed to create recurring template";

        setError(message);
        notifyError(message);
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  const handleGenerateDraft = (template: RecurringExpenseTemplate) => {
    setGeneratingTemplateId(template.id);

    void (async () => {
      try {
        const response = await fetch("/api/expenses/recurring/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: template.id,
            periodMonth: currentMonthKey,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(
            body.error ?? "Failed to create recurring expense draft",
          );
        }

        notifySuccess(`Draft created from ${template.description}`);
        router.refresh();
      } catch (submitError) {
        notifyError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create recurring expense draft",
        );
      } finally {
        setGeneratingTemplateId(null);
      }
    })();
  };

  return (
    <>
      <SectionCard
        title="Recurring expenses"
        description="Save monthly utility, rent, insurance, and similar templates, then generate the current month draft when it is due."
        action={
          <button
            type="button"
            onClick={openCreateModal}
            disabled={!canManageExpenses}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            <Plus className="h-4 w-4" />
            Add recurring
          </button>
        }
      >
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
            <div className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Active templates
            </div>
            <div className="mt-1 text-2xl font-semibold text-dark dark:text-white">
              {activeTemplateCount}
            </div>
          </div>
          <div className="rounded-[18px] border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
            <div className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Ready this month
            </div>
            <div className="mt-1 text-2xl font-semibold text-dark dark:text-white">
              {readyTemplateCount}
            </div>
          </div>
          <div className="rounded-[18px] border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
            <div className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Drafted or posted
            </div>
            <div className="mt-1 text-2xl font-semibold text-dark dark:text-white">
              {currentMonthCreatedCount}
            </div>
          </div>
        </div>

        <Table totalRows={templates.length}>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Due day</TableHead>
              <TableHead>{CURRENT_MONTH_LABEL}</TableHead>
              <TableHead className="text-right">Default amount</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                >
                  No recurring expense templates have been saved yet.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((template) => {
                const currentMonthExpense =
                  currentMonthExpenseByTemplate.get(
                    getTemplateExpenseKey(template.id, currentMonthKey),
                  ) ?? null;
                const latestExpense =
                  latestExpenseByTemplate.get(template.id) ?? null;
                const canGenerateDraft =
                  template.active &&
                  (!currentMonthExpense ||
                    currentMonthExpense.status === "void");

                return (
                  <TableRow key={template.id}>
                    <TableCell>
                      <div className="font-semibold text-dark dark:text-white">
                        {template.description}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-dark-5 dark:text-dark-6">
                        <StatusBadge tone={template.active ? "green" : "slate"}>
                          {template.active ? "Active" : "Paused"}
                        </StatusBadge>
                        {template.vendorName ? (
                          <span>{template.vendorName}</span>
                        ) : null}
                      </div>
                      {template.notes ? (
                        <div className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                          {template.notes}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{template.category}</TableCell>
                    <TableCell>Day {template.dueDayOfMonth}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={getCurrentMonthTone(
                            template,
                            currentMonthExpense,
                          )}
                        >
                          {getCurrentMonthLabel(template, currentMonthExpense)}
                        </StatusBadge>
                        <span className="text-xs text-dark-5 dark:text-dark-6">
                          {currentMonthLabel}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        {latestExpense?.recurringPeriodMonth
                          ? `Last draft month: ${formatRecurringExpenseMonthLabel(
                              latestExpense.recurringPeriodMonth
                                .toISOString()
                                .slice(0, 10),
                            )}`
                          : "No recurring draft has been created yet."}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                      {formatCurrency(template.defaultAmount)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {canGenerateDraft ? (
                          <button
                            type="button"
                            onClick={() => handleGenerateDraft(template)}
                            disabled={
                              !canManageExpenses ||
                              generatingTemplateId === template.id
                            }
                            className="app-secondary-button-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {generatingTemplateId === template.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Create draft
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openEditModal(template)}
                          disabled={!canManageExpenses}
                          className="app-icon-button app-icon-button-accent disabled:cursor-not-allowed disabled:opacity-60"
                          title="Edit recurring template"
                          aria-label="Edit recurring template"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </SectionCard>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                editingTemplate
                  ? "Edit recurring expense template"
                  : "Add recurring expense template"
              }
              className="modal-card max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark"
            >
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    {editingTemplate
                      ? "Edit recurring expense"
                      : "Add recurring expense"}
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Monthly templates create draft expenses inside the normal
                    approval flow.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="app-icon-button disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Close recurring expense dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Template name
                    </label>
                    <input
                      required
                      value={formState.description}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Electric bill"
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
                        setFormState((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                    >
                      <option value="">Select category</option>
                      {EXPENSE_CATEGORY_OPTIONS.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Default amount
                    </label>
                    <CurrencyInput
                      required
                      value={formState.defaultAmount}
                      onValueChange={(decimalValue) =>
                        setFormState((current) => ({
                          ...current,
                          defaultAmount: decimalValue,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Due day of month
                    </label>
                    <input
                      required
                      type="number"
                      min="1"
                      max="31"
                      step="1"
                      value={formState.dueDayOfMonth}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          dueDayOfMonth: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payee or vendor
                    </label>
                    <input
                      value={formState.vendorName}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          vendorName: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Utility company, landlord, insurer"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payment method
                    </label>
                    <select
                      value={formState.paymentMethod}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          paymentMethod: event.target.value,
                        }))
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

                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Notes
                    </label>
                    <textarea
                      value={formState.notes}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      className={`${INPUT_CLASSNAME} min-h-[120px] resize-y`}
                      placeholder="Meter account, contract number, or approval context."
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-lg border border-stroke px-4 py-3 text-sm text-dark dark:border-dark-3 dark:text-dark-6 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={formState.active}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          active: event.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-stroke text-primary focus:ring-primary"
                    />
                    <span>
                      Keep this template active for future monthly drafts.
                    </span>
                  </label>
                </div>

                {error ? (
                  <div className="mt-4 rounded-xl border border-red/20 bg-red/10 px-4 py-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
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
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {editingTemplate ? "Save changes" : "Save template"}
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
