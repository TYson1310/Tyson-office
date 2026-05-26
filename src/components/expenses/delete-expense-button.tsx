"use client";

import { ExpenseReviewActionButton } from "@/components/expenses/expense-review-action-button";

type DeleteExpenseButtonProps = {
  expenseId: string;
  expenseName: string;
  disabled?: boolean;
};

export function DeleteExpenseButton({
  expenseId,
  expenseName,
  disabled = false,
}: DeleteExpenseButtonProps) {
  return (
    <ExpenseReviewActionButton
      expenseId={expenseId}
      expenseName={expenseName}
      action="void"
      disabled={disabled}
    />
  );
}
