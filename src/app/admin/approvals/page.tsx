import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ExpenseStatusButton } from "@/components/expenses/expense-status-button";
import {
  AddExpenseButton,
  type EditableExpenseRecord,
} from "@/components/expenses/add-expense-button";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { DeleteVendorAdjustmentButton } from "@/components/vendors/delete-vendor-adjustment-button";
import { VendorAdjustmentStatusButton } from "@/components/vendors/vendor-adjustment-status-button";
import { VendorAttachmentActions } from "@/components/vendors/vendor-attachment-actions";
import { formatCurrency, getOperationsDataset } from "@/lib/erp/operations";
import {
  buildApprovalQueueRows,
  type ApprovalQueueRow,
} from "@/lib/erp/reporting";
import { ensureDueRecurringExpenseDraftsForActiveStore } from "@/lib/expenses/recurring-drafts";
import { VENDOR_ADJUSTMENT_STATUS_LABELS } from "@/lib/vendors/adjustments";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Approvals",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function approvalTypeTone(category: ApprovalQueueRow["category"]) {
  return category === "expense" ? ("blue" as const) : ("amber" as const);
}

function formatDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

export default async function ApprovalsPage() {
  await ensureDueRecurringExpenseDraftsForActiveStore();
  const dataset = await getOperationsDataset();
  const canManageApprovals = dataset.source === "database";
  const queue = buildApprovalQueueRows(dataset);
  const draftAdjustments = dataset.vendorAdjustments.filter(
    (adjustment) => adjustment.status === "draft",
  );
  const draftExpenses = dataset.expenses.filter(
    (expense) => expense.status === "draft",
  );
  const draftAdjustmentValue = draftAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    0,
  );
  const draftExpenseValue = draftExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const oldestItem = queue[queue.length - 1] ?? null;
  const metrics = [
    {
      label: "Pending approvals",
      value: `${queue.length}`,
      change: `${draftAdjustments.length} supplier / ${draftExpenses.length} expense`,
      detail: "draft finance records waiting to post",
      tone: "amber" as const,
    },
    {
      label: "Supplier drafts",
      value: formatCurrency(draftAdjustmentValue),
      change: `${draftAdjustments.length} records`,
      detail: "excluded from payables until approved",
      tone: "violet" as const,
    },
    {
      label: "Expense drafts",
      value: formatCurrency(draftExpenseValue),
      change: `${draftExpenses.length} records`,
      detail: "excluded from net profit until approved",
      tone: "blue" as const,
    },
    {
      label: "Oldest draft",
      value: oldestItem ? formatDate(oldestItem.createdAt) : "None",
      change: oldestItem ? oldestItem.title : "Clear queue",
      detail: "oldest pending finance item",
      tone: "green" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Approvals" />

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
          title="Supplier adjustment approvals"
          description="Approve or discard draft supplier adjustments before they affect payables and stock."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Attachment</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draftAdjustments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-dark-5 dark:text-dark-6"
                  >
                    No supplier adjustment drafts are waiting right now.
                  </TableCell>
                </TableRow>
              ) : (
                draftAdjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell>
                      <div className="font-semibold text-dark dark:text-white">
                        {adjustment.adjustmentNumber}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        <StatusBadge tone="amber">
                          {VENDOR_ADJUSTMENT_STATUS_LABELS[adjustment.status]}
                        </StatusBadge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {adjustment.vendorName}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {adjustment.reason ??
                          adjustment.adjustmentType.replace(/_/g, " ")}
                      </div>
                    </TableCell>
                    <TableCell>
                      {formatDate(adjustment.adjustmentDate)}
                    </TableCell>
                    <TableCell>
                      {adjustment.attachmentUrl ? (
                        <VendorAttachmentActions
                          href={adjustment.attachmentUrl}
                          downloadHref={`${adjustment.attachmentUrl}&download=1`}
                          label={
                            adjustment.attachmentName ?? "Supporting document"
                          }
                          kindHint={
                            adjustment.attachmentMimeType ??
                            adjustment.attachmentName
                          }
                        />
                      ) : (
                        "No file"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                      {formatCurrency(adjustment.amount)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <VendorAdjustmentStatusButton
                          adjustmentId={adjustment.id}
                          adjustmentNumber={adjustment.adjustmentNumber}
                          action="approved"
                          inventoryImpact={adjustment.inventoryImpact}
                          disabled={!canManageApprovals}
                        />
                        <DeleteVendorAdjustmentButton
                          adjustmentId={adjustment.id}
                          adjustmentNumber={adjustment.adjustmentNumber}
                          inventoryImpact={adjustment.inventoryImpact}
                          disabled={!canManageApprovals}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </SectionCard>
        <div className="mt-6">
          <SectionCard
            title="Expense approvals"
            description="Approve draft operating expenses so they flow into the selected store’s net profit."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expense</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draftExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-dark-5 dark:text-dark-6"
                    >
                      No draft expenses are waiting right now.
                    </TableCell>
                  </TableRow>
                ) : (
                  draftExpenses.map((expense) => {
                    const editableExpense: EditableExpenseRecord = {
                      id: expense.id,
                      category: expense.category,
                      amount: expense.amount,
                      subtotalAmount: expense.subtotalAmount,
                      taxAmount: expense.taxAmount,
                      description: expense.description,
                      expenseDate: formatDateInput(expense.date),
                      vendorName: expense.vendorName ?? "",
                      paymentMethod: expense.paymentMethod ?? "",
                      notes: expense.notes ?? "",
                      status: expense.status,
                      attachmentName: expense.attachmentName,
                      attachmentUrl: expense.attachmentUrl,
                    };

                    return (
                      <TableRow key={expense.id}>
                        <TableCell>
                          <div className="font-semibold text-dark dark:text-white">
                            {expense.description}
                          </div>
                          {expense.notes ? (
                            <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                              {expense.notes}
                            </div>
                          ) : null}
                          {expense.attachmentUrl ? (
                            <div className="mt-2">
                              <VendorAttachmentActions
                                href={expense.attachmentUrl}
                                label={expense.attachmentName ?? "Bill copy"}
                                title="Expense document"
                              />
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={approvalTypeTone("expense")}>
                            {expense.category}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>{formatDate(expense.date)}</TableCell>
                        <TableCell className="text-right font-semibold text-dark dark:text-white">
                          {formatCurrency(expense.amount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <ExpenseStatusButton
                              expenseId={expense.id}
                              expenseName={expense.description}
                              action="approved"
                              disabled={!canManageApprovals}
                            />
                            <AddExpenseButton
                              expense={editableExpense}
                              iconOnly
                              disabled={!canManageApprovals}
                            />
                            <DeleteExpenseButton
                              expenseId={expense.id}
                              expenseName={expense.description}
                              disabled={!canManageApprovals}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
