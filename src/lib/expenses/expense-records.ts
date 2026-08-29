import { normalizeExpenseCategory } from "./categories.ts";
import type { ExpenseRecordStatus } from "@/types/erp.types";

const EXPENSE_ATTACHMENT_REQUIRED_CATEGORIES = new Set(["Utilities"]);
const DUPLICATE_EXPENSE_WINDOW_DAYS = 7;

export type ExpenseAmountBreakdown = {
  totalAmount: number;
  subtotalAmount: number;
  taxAmount: number;
};

export type DuplicateExpenseCandidate = {
  id: string;
  description: string;
  category: string;
  amount: number;
  date: Date | string;
  status: ExpenseRecordStatus;
  supplierId?: string | null;
  vendorName?: string | null;
};

export type DuplicateExpenseInput = {
  expenseId?: string;
  description: string;
  category: string;
  amount: number;
  expenseDate: string;
  supplierId?: string | null;
  vendorName?: string | null;
};

export type DuplicateExpenseMatch = {
  id: string;
  description: string;
  category: string;
  amount: number;
  expenseDate: string;
  status: ExpenseRecordStatus;
  vendorName?: string;
  supplierId?: string;
};

function normalizeFreeText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function roundExpenseCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function toIsoDateKey(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function getUtcDayIndex(dateKey: string) {
  const [yearLabel, monthLabel, dayLabel] = dateKey.split("-");
  const year = Number(yearLabel);
  const month = Number(monthLabel);
  const day = Number(dayLabel);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return Number.NaN;
  }

  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isSameVendor(
  input: Pick<DuplicateExpenseInput, "supplierId" | "vendorName">,
  candidate: Pick<DuplicateExpenseCandidate, "supplierId" | "vendorName">,
) {
  if (input.supplierId && candidate.supplierId) {
    return input.supplierId === candidate.supplierId;
  }

  const inputVendorKey = normalizeFreeText(input.vendorName);
  const candidateVendorKey = normalizeFreeText(candidate.vendorName);

  if (inputVendorKey && candidateVendorKey) {
    return inputVendorKey === candidateVendorKey;
  }

  return false;
}

function isCloseExpenseDate(left: string, right: string) {
  const leftDayIndex = getUtcDayIndex(left);
  const rightDayIndex = getUtcDayIndex(right);

  if (!Number.isFinite(leftDayIndex) || !Number.isFinite(rightDayIndex)) {
    return false;
  }

  return (
    Math.abs(leftDayIndex - rightDayIndex) <= DUPLICATE_EXPENSE_WINDOW_DAYS
  );
}

export function buildExpenseAmountBreakdown(
  totalAmount: number,
  taxAmount: number | null | undefined,
): ExpenseAmountBreakdown | null {
  const normalizedTotalAmount = roundExpenseCurrency(totalAmount);
  const normalizedTaxAmount = roundExpenseCurrency(taxAmount ?? 0);

  if (!Number.isFinite(normalizedTotalAmount) || normalizedTotalAmount <= 0) {
    return null;
  }

  if (!Number.isFinite(normalizedTaxAmount) || normalizedTaxAmount < 0) {
    return null;
  }

  if (normalizedTaxAmount > normalizedTotalAmount) {
    return null;
  }

  return {
    totalAmount: normalizedTotalAmount,
    subtotalAmount: roundExpenseCurrency(
      normalizedTotalAmount - normalizedTaxAmount,
    ),
    taxAmount: normalizedTaxAmount,
  };
}

export function isExpenseAttachmentRequiredForApproval(input: {
  category: string;
  amount: number;
}) {
  const normalizedCategory = normalizeExpenseCategory(input.category);

  return Boolean(
    normalizedCategory &&
      EXPENSE_ATTACHMENT_REQUIRED_CATEGORIES.has(normalizedCategory),
  );
}

export function getExpenseAttachmentRequirementMessage(input: {
  category: string;
  amount: number;
}) {
  const normalizedCategory =
    normalizeExpenseCategory(input.category) ?? "Other";

  if (normalizedCategory === "Utilities") {
    return "Utilities require a bill copy before approval.";
  }

  return "A supporting copy is required before approval.";
}

export function findPotentialDuplicateExpenses(
  input: DuplicateExpenseInput,
  expenses: DuplicateExpenseCandidate[],
): DuplicateExpenseMatch[] {
  const normalizedCategory = normalizeExpenseCategory(input.category);
  const normalizedDescription = normalizeFreeText(input.description);

  return expenses
    .filter((expense) => {
      if (expense.status === "void") {
        return false;
      }

      if (input.expenseId && expense.id === input.expenseId) {
        return false;
      }

      if (
        roundExpenseCurrency(expense.amount) !==
        roundExpenseCurrency(input.amount)
      ) {
        return false;
      }

      if (
        (normalizeExpenseCategory(expense.category) ?? expense.category) !==
        normalizedCategory
      ) {
        return false;
      }

      const candidateDateKey = toIsoDateKey(expense.date);
      if (!isCloseExpenseDate(input.expenseDate, candidateDateKey)) {
        return false;
      }

      if (isSameVendor(input, expense)) {
        return true;
      }

      const candidateDescription = normalizeFreeText(expense.description);
      return Boolean(
        !input.supplierId &&
          !normalizeFreeText(input.vendorName) &&
          normalizedDescription &&
          candidateDescription &&
          normalizedDescription === candidateDescription,
      );
    })
    .map((expense) => ({
      id: expense.id,
      description: expense.description,
      category: normalizeExpenseCategory(expense.category) ?? expense.category,
      amount: roundExpenseCurrency(expense.amount),
      expenseDate: toIsoDateKey(expense.date),
      status: expense.status,
      vendorName: expense.vendorName ?? undefined,
      supplierId: expense.supplierId ?? undefined,
    }))
    .sort((left, right) => {
      const leftDistance = Math.abs(
        getUtcDayIndex(left.expenseDate) - getUtcDayIndex(input.expenseDate),
      );
      const rightDistance = Math.abs(
        getUtcDayIndex(right.expenseDate) - getUtcDayIndex(input.expenseDate),
      );

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return right.expenseDate.localeCompare(left.expenseDate);
    });
}
