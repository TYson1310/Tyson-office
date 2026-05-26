import type { PayrollPaymentMethod } from "@/types/erp.types";

export const DEFAULT_PAYROLL_PAYMENT_METHOD: PayrollPaymentMethod =
  "direct_deposit";

export const PAYROLL_PAYMENT_METHOD_OPTIONS = [
  { value: "direct_deposit", label: "Direct Deposit" },
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "payroll_card", label: "Payroll Card" },
  { value: "other", label: "Other" },
] as const satisfies ReadonlyArray<{
  value: PayrollPaymentMethod;
  label: string;
}>;

export const PAYROLL_PAYMENT_METHOD_LABELS: Record<
  PayrollPaymentMethod,
  string
> = Object.fromEntries(
  PAYROLL_PAYMENT_METHOD_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PayrollPaymentMethod, string>;

export function isPayrollPaymentMethod(
  value: unknown,
): value is PayrollPaymentMethod {
  return PAYROLL_PAYMENT_METHOD_OPTIONS.some((option) => option.value === value);
}

export function formatPayrollPaymentMethod(value: string | null | undefined) {
  if (value && isPayrollPaymentMethod(value)) {
    return PAYROLL_PAYMENT_METHOD_LABELS[value];
  }

  if (!value) {
    return PAYROLL_PAYMENT_METHOD_LABELS[DEFAULT_PAYROLL_PAYMENT_METHOD];
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
