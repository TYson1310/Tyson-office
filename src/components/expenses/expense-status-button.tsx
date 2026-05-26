"use client";

import { ExpenseReviewActionButton } from "@/components/expenses/expense-review-action-button";

type ExpenseStatusButtonProps = {
  expenseId: string;
  expenseName: string;
  action: "approved";
  disabled?: boolean;
};

export function ExpenseStatusButton({
  expenseId,
  expenseName,
  action,
  disabled = false,
}: ExpenseStatusButtonProps) {
  return (
    <ExpenseReviewActionButton
      expenseId={expenseId}
      expenseName={expenseName}
      action={action}
      disabled={disabled}
    />
  );
}
